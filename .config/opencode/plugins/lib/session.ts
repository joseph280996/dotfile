/**
 * Shared session-state derivation for opencode plugins.
 *
 * See docs/superpowers/specs/2026-08-05-opencode-hook-gating-layer-design.md
 *
 * ## Why derived rather than remembered
 *
 * Facts are derived on demand from `client.session.messages()` rather than kept
 * in a module-level counter. Two reasons:
 *
 * - **Durability.** In-memory counters reset whenever the plugin process
 *   restarts, silently re-arming gates mid-task.
 * - **Parity.** The Claude Code side of this mechanism (`stop-advisor.sh`)
 *   derives the same facts from the transcript JSONL. Deriving here too means
 *   the two platforms cannot drift apart.
 *
 * ## What derivation does NOT replace
 *
 * Derived facts cannot serve as an in-flight mutex. `client.session.prompt`
 * blocks for the whole dispatched turn, and that turn ending publishes another
 * `session.idle` — so an `event` handler reliably overlaps with itself. A caller
 * that dispatches work must keep its own synchronous guard, set before its first
 * `await`. See the `dispatchAnchor` note in advisor.ts.
 *
 * ## Cost
 *
 * `readSession` costs up to two HTTP round-trips to the local server plus full
 * message-history deserialization — O(session length), so it degrades as a
 * session grows.
 *
 * Safe: `session.idle`-frequency hooks (a handful of calls per session).
 * NOT safe: `tool.execute.before` / `tool.execute.after`, which fire on EVERY
 * tool call. A hook on that path must use its own in-memory counter.
 *
 * There is deliberately **no cache**. An earlier revision memoized on message
 * count, but the count is only knowable *from* the fetch, so both round-trips
 * happened before the cache could be consulted — it saved only a
 * microsecond-scale array walk while implying a saving it did not deliver.
 * Measured: three calls produced three `session.get()` plus three
 * `session.messages()`. Removed rather than left misleading. Revisit only with
 * event-driven invalidation and a measurement that justifies it.
 *
 * Every export is NON-THROWING — `event` hooks have no error path, so a throw
 * here becomes an unhandled rejection.
 */

/** Structural subset of the SDK client, so this module needn't import the SDK. */
type SessionClient = {
  session: {
    get: (args: { path: { id: string } }) => Promise<{ data?: SessionInfo | null }>
    messages: (args: { path: { id: string } }) => Promise<{ data?: MessageEntry[] | null }>
  }
}

type SessionInfo = {
  parentID?: string | null
}

/**
 * A message part. Fields beyond `type` are per-variant; a stored `subtask` part
 * carries `{ prompt, description, agent }` (verified against
 * `@opencode-ai/sdk` `types.gen.d.ts` — the `Part` union member for
 * `type: "subtask"`).
 *
 * `state.error` is the tool-part variant, populated for `type: "tool"` parts.
 * A subtask cancelled by ESC mid-run writes `state.error: "Cancelled"` from
 * `handleSubtask`'s `onInterrupt` (opencode `session/prompt.ts`), before that
 * turn's `session.idle` — unlike the message-level abort fields below, which
 * lose a race against idle. See the `subtaskCancelled` fact below.
 *
 * `status` is declared alongside `error` (and required, matching the real SDK
 * shape) purely so this structural type shares a property with the SDK's
 * `ToolPart["state"]` — a `ToolState` union whose members do not all carry
 * `error`. An all-optional `{ error?: string }` shares nothing with e.g.
 * `ToolStateCompleted`, which trips TypeScript's weak-type check when the
 * real client is passed in.
 */
type MessagePart = {
  type?: string
  text?: string
  agent?: string
  description?: string
  state?: { status: string; error?: string } | null
}

type MessageEntry = {
  info?: {
    role?: string
    error?: { name?: string } | null
    /**
     * Absent until the turn actually completes (opencode `session/processor.ts`
     * `cleanup()`), even after an abort — see `turnIncomplete` below.
     *
     * `created` is declared alongside `completed` (and required, matching the
     * real SDK shape) purely so this structural type shares a property with
     * the SDK's `Message["time"]` — an all-optional shape has none in common
     * with the SDK's `{ created: number }` on `UserMessage`, which trips
     * TypeScript's weak-type check when the real client is passed in.
     */
    time?: { created: number; completed?: number } | null
  } | null
  parts?: MessagePart[] | null
}

/** A predicate identifying a "marker" part to count from. */
export type PartMarker = (part: MessagePart) => boolean

/**
 * Why `readSession` declined to produce facts.
 *
 * Distinguished rather than collapsed into a bare `undefined` so a caller can
 * tell "this is a subagent session, by design" from "something went wrong".
 */
export type SessionSkip =
  | "no-session-id"
  | "not-found"
  | "not-root"
  | "no-messages"
  | "error"

export type SessionFacts = {
  /** Message count at the time of reading. */
  messageCount: number
  /** True when the turn was interrupted (ESC/abort) rather than completing. */
  wasAborted: boolean
  /**
   * True when the last message is an assistant turn with no `time.completed`
   * yet — i.e. `session.idle` fired before that turn's completion (or abort)
   * was persisted, not because it actually finished.
   *
   * Closes a race in opencode `session/processor.ts`: on ESC, `halt` sets the
   * abort error in memory and publishes idle BEFORE `cleanup()` persists
   * `time.completed` (and the error) via `Effect.ensuring`. A plugin's
   * `session.idle` handler can read the message before that persist lands, so
   * `wasAborted` sees `error` as absent and fails open. A genuinely finished
   * turn cannot trigger this: `cleanup()` runs, inside `Effect.ensuring`,
   * before the work fiber exits — and only the fiber's exit publishes idle on
   * the clean path (`effect/runner.ts` `finishRun`). So "assistant message,
   * `time.completed` absent" only ever holds mid-abort, never on completion.
   */
  turnIncomplete: boolean
  /**
   * True when the last message's parts include a `tool` part with
   * `state.error === "Cancelled"` — the subtask-specific interrupt marker
   * written by `handleSubtask`'s `onInterrupt` in opencode `session/prompt.ts`.
   *
   * Covers a second, distinct interrupt hole that neither `wasAborted` nor
   * `turnIncomplete` sees: ESC during a running `task`-tool subtask sets
   * `finish: "tool-calls"` and `time.completed` (so `turnIncomplete` is
   * false) but no message-level `error` (so `wasAborted` is false too) —
   * because that path never calls `halt`. The tool part's `state.error` is
   * written and persisted synchronously inside the same `onInterrupt`, before
   * idle, so it does not race the way the message-level fields do.
   *
   * Exact string match on `"Cancelled"` only — deliberately does not match
   * `"Tool execution failed: Task cancelled"` (a different failure path with
   * no interrupt semantics) or `"Tool execution aborted"` (the non-subtask
   * tool-abort marker, written inside the same racing `cleanup()` as
   * `time.completed`, so it would reintroduce the `turnIncomplete` race).
   */
  subtaskCancelled: boolean
  /** Text of the final assistant message, for handoff/question heuristics. */
  lastAssistantText: string
  /**
   * Tool calls since the last part matching `marker` (or since session start if
   * none matches). Measures "work done since the last checkpoint" rather than
   * whole-history volume, which would re-fire on every idle once a long session
   * crossed a threshold.
   */
  toolCallsSince: (marker: PartMarker) => number
  /** How many parts match `marker` across the whole session. */
  countMatching: (marker: PartMarker) => number
}

export type SessionResult =
  | { ok: true; facts: SessionFacts }
  | { ok: false; skip: SessionSkip }

/**
 * Derive session facts for a root session.
 *
 * Returns `{ ok: false, skip }` rather than throwing. Non-root sessions are
 * rejected **before** fetching messages: a subagent's own idle would re-trigger
 * whatever dispatched it, so the message fetch would be pure waste — and
 * subagent idles are common (20 advisor sessions in the current log).
 */
export async function readSession(
  client: SessionClient,
  sessionID: string | undefined,
): Promise<SessionResult> {
  try {
    if (!sessionID) return { ok: false, skip: "no-session-id" }

    const session = await client.session.get({ path: { id: sessionID } })
    const info = session.data
    if (!info) return { ok: false, skip: "not-found" }

    // Root sessions only, checked before the second round-trip.
    if (info.parentID) return { ok: false, skip: "not-root" }

    const messages = await client.session.messages({ path: { id: sessionID } })
    const list = messages.data ?? []
    if (!list.length) return { ok: false, skip: "no-messages" }

    let lastAssistantText = ""
    for (const message of list) {
      if (message?.info?.role !== "assistant") continue
      for (const part of message.parts ?? []) {
        if (part?.type === "text" && part.text) lastAssistantText = part.text
      }
    }

    // `session.idle` also fires on ESC/abort. An aborted turn that already made
    // enough tool calls would otherwise trip a gate on work the user explicitly
    // interrupted. The abort also writes an error part, growing the message
    // count, so a count-based guard alone fails open here.
    const last = list[list.length - 1]
    const wasAborted =
      last?.info?.role === "assistant" && last.info.error?.name === "MessageAbortedError"

    // See the `turnIncomplete` doc comment: catches the same abort, one step
    // earlier — before `error` itself has been persisted, not just before its
    // name is knowable.
    const turnIncomplete = last?.info?.role === "assistant" && !last.info.time?.completed

    // See the `subtaskCancelled` doc comment: catches an abort that never
    // reaches the message-level fields above at all.
    const subtaskCancelled =
      last?.info?.role === "assistant" &&
      (last.parts ?? []).some((part) => part?.type === "tool" && part.state?.error === "Cancelled")

    return {
      ok: true,
      facts: {
        messageCount: list.length,
        wasAborted,
        turnIncomplete,
        subtaskCancelled,
        lastAssistantText,
        toolCallsSince: (marker) => countToolCallsSince(list, marker),
        countMatching: (marker) => countMatching(list, marker),
      },
    }
  } catch {
    return { ok: false, skip: "error" }
  }
}

function countToolCallsSince(list: MessageEntry[], marker: PartMarker): number {
  let count = 0
  for (const message of list) {
    for (const part of message?.parts ?? []) {
      if (!part) continue
      // Reset on the marker so we count only activity after it.
      if (safeMarker(marker, part)) count = 0
      else if (part.type === "tool") count++
    }
  }
  return count
}

function countMatching(list: MessageEntry[], marker: PartMarker): number {
  let count = 0
  for (const message of list) {
    for (const part of message?.parts ?? []) {
      if (part && safeMarker(marker, part)) count++
    }
  }
  return count
}

/** A caller-supplied predicate must not be able to throw into a hook. */
function safeMarker(marker: PartMarker, part: MessagePart): boolean {
  try {
    return marker(part) === true
  } catch {
    return false
  }
}

/**
 * Matches any subtask dispatched to `agent`, whoever initiated it.
 *
 * Use for "when was this agent last consulted, by anyone" — e.g. resetting a
 * work counter, where a manual consult should reset it just as a plugin-initiated
 * one would, because advice was in fact just given.
 */
export function subtaskMarker(agent: string): PartMarker {
  return (part) => part?.type === "subtask" && part.agent === agent
}

/**
 * Matches only subtasks this plugin dispatched, by agent AND description.
 *
 * Necessary for any per-session dispatch cap. A `subtask` part is created for
 * *every* subagent invocation, including ones the main agent makes itself (this
 * config's AGENTS.md actively instructs manual `@advisor` use — 20 such sessions
 * in the current log, against a cap of 3). Counting those against a plugin's own
 * budget would exhaust it before the plugin ever fired.
 *
 * `description` is a reliable discriminator: it is a required field on
 * `SubtaskPartInput` and is retained verbatim on the stored part, so a plugin's
 * fixed description string identifies its own dispatches.
 */
export function pluginSubtaskMarker(agent: string, description: string): PartMarker {
  return (part) =>
    part?.type === "subtask" && part.agent === agent && part.description === description
}
