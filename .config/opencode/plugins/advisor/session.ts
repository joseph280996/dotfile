/**
 * Shared session-state derivation for opencode plugins.
 *
 * See docs/superpowers/specs/2026-08-05-opencode-hook-gating-layer-design.md
 *
 * ## Why derived rather than remembered
 *
 * Facts are derived on demand from the session context (`ctx.session.context`)
 * rather than kept in a module-level counter. Two reasons:
 *
 * - **Durability.** In-memory counters reset whenever the plugin process
 *   restarts, silently re-arming gates mid-task.
 * - **Parity.** The Claude Code side of this mechanism (`stop-advisor.sh`)
 *   derives the same facts from the transcript JSONL. Deriving here too means
 *   the two platforms cannot drift apart.
 *
 * ## What derivation does NOT replace
 *
 * Derived facts cannot serve as an in-flight mutex. A dispatched consult blocks
 * the event handler for its whole run, and that turn ending publishes another
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
 * NOT safe: `execute.before` / `execute.after` tool hooks, which fire on EVERY
 * tool call. A hook on that path must use its own in-memory counter.
 *
 * There is deliberately **no cache**. An earlier revision memoized on message
 * count, but the count is only knowable *from* the fetch, so both round-trips
 * happened before the cache could be consulted — it saved only a
 * microsecond-scale array walk while implying a saving it did not deliver.
 * Measured: three calls produced three fetches. Removed rather than left
 * misleading.
 *
 * Every export is NON-THROWING — `event` hooks have no error path, so a throw
 * here becomes an unhandled rejection.
 *
 * ## V2 message shapes
 *
 * Derived against the v2.0.20 wire contract (`SessionMessageInfo`): an
 * assistant message carries `agent`, `content[]` items (`text` / `reasoning` /
 * `tool`), a message-level `error` (`SessionStructuredError`), and
 * `time.completed`. A `subtask` message type no longer exists; tool-part
 * errors carry a structured `error.message` string instead of `state.error`.
 */

/** Structural subset of the V2 plugin session context, so this module needn't import package types. */
type SessionClient = {
  session: {
    get: (args: { sessionID: string }) => Promise<SessionInfo>
    context: (args: { sessionID: string }) => Promise<SessionMessage[]>
  }
}

type SessionInfo = {
  parentID?: string | null
  /** Consult sessions created by this plugin are tagged in metadata; the caller checks this before readSession. */
  metadata?: Record<string, unknown> | null
}

/**
 * One content item of a V2 assistant message. Tool items carry a `state`
 * union whose `error` member holds a structured error with a `message`.
 */
type MessageContent = {
  type?: string
  text?: string
  state?: { status?: string; error?: { type?: string; message?: string } | null } | null
}

type SessionMessage = {
  type?: string
  agent?: string
  /** Assistant messages only (`SessionStructuredError`). */
  error?: unknown | null
  /** Absent until the turn actually completes — see `turnIncomplete`. */
  time?: { created?: number; completed?: number } | null
  content?: MessageContent[] | null
  /** Synthetic relay messages carry the plugin's discriminators here. */
  text?: string
  description?: string
  metadata?: Record<string, unknown> | null
}

/** A predicate identifying a "marker" item to count from. */
export type PartMarker = (part: MessageContent | SessionMessage) => boolean

/**
 * Why `readSession` declined to produce facts.
 *
 * Distinguished rather than collapsed into a bare `undefined` so a caller can
 * tell "this is a consult/subagent session, by design" from "something went wrong".
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
  /**
   * True when the turn ended in an error rather than completing — ESC/abort
   * or a provider/model failure. The guard generalizes to "any message-level
   * error at all": 60 days of V1 root turns showed 33 turns that died on an
   * error still reached a consult on the name-only match.
   *
   * Distinct from `turnIncomplete`: a turn whose error has been persisted is
   * *errored*; a turn whose completion (or abort) has not been persisted yet
   * is *incomplete*, error or not.
   */
  turnErrored: boolean
  /**
   * True when the last message is an assistant turn with no `time.completed`
   * yet — i.e. `session.idle` fired before that turn's completion (or abort)
   * was persisted, not because it actually finished.
   *
   * Closes the abort persist race: on ESC the abort error is set in memory and
   * idle is published BEFORE completion is persisted. A genuinely finished
   * turn cannot trigger this — "assistant message, `time.completed` absent"
   * only ever holds mid-abort, never on completion.
   */
  turnIncomplete: boolean
  /**
   * True when the last assistant turn's tool content includes an interrupted
   * subagent/subtask — the ESC-during-subtask hole that neither `turnErrored`
   * nor `turnIncomplete` sees (that path completes the message without a
   * message-level error, so the two facts above both miss it).
   */
  subtaskCancelled: boolean
  /**
   * True when the last message is an assistant message whose tool content was
   * rejected or dismissed by the user — see `userRejectionMarker()` for what
   * counts. String matching on the tool error message is the only available
   * discriminator: no other message field carries the signal.
   */
  userRejected: boolean
  /** Text of the final assistant message, for handoff/question heuristics. */
  lastAssistantText: string
  /**
   * Tool calls since the last item matching `marker` (or since session start if
   * none matches). Measures "work done since the last checkpoint" rather than
   * whole-history volume, which would re-fire on every idle once a long session
   * crossed a threshold.
   */
  toolCallsSince: (marker: PartMarker) => number
  /** How many items match `marker` across the whole session. */
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
 * whatever dispatched it, so the message fetch would be pure waste.
 */
export async function readSession(
  client: SessionClient,
  sessionID: string | undefined,
): Promise<SessionResult> {
  try {
    if (!sessionID) return { ok: false, skip: "no-session-id" }

    const info = await client.session.get({ sessionID })
    if (!info) return { ok: false, skip: "not-found" }

    // Root sessions only, checked before the second round-trip.
    if (info.parentID) return { ok: false, skip: "not-root" }

    const list = await client.session.context({ sessionID })
    if (!list.length) return { ok: false, skip: "no-messages" }

    let lastAssistantText = ""
    for (const message of list) {
      if (message?.type !== "assistant") continue
      for (const item of message.content ?? []) {
        if (item?.type === "text" && item.text) lastAssistantText = item.text
      }
    }

    // `session.idle` also fires on ESC/abort. A turn that ended in an error
    // (aborted, or a provider/model failure) is not a completion, even if it
    // did enough work. The abort also writes an error entry, growing the
    // message count, so a count-based guard alone fails open here.
    const last = list[list.length - 1]
    const turnErrored = last?.type === "assistant" && last.error != null

    // See the `turnIncomplete` doc comment: catches the same abort, one step
    // earlier — before `error` itself has been persisted, not just before its
    // name is knowable.
    const turnIncomplete = last?.type === "assistant" && !last.time?.completed

    // See the `subtaskCancelled` doc comment: catches an abort that never
    // reaches the message-level fields above at all.
    const subtaskCancelled =
      last?.type === "assistant" &&
      (last.content ?? []).some((part) => isSubtaskCancel(part))

    const userRejected =
      last?.type === "assistant" &&
      (last.content ?? []).some((part) => isUserRejection(part))

    return {
      ok: true,
      facts: {
        messageCount: list.length,
        turnErrored,
        turnIncomplete,
        subtaskCancelled,
        userRejected,
        lastAssistantText,
        toolCallsSince: (marker) => countToolCallsSince(list, marker),
        countMatching: (marker) => countMatching(list, marker),
      },
    }
  } catch {
    return { ok: false, skip: "error" }
  }
}

function countToolCallsSince(list: SessionMessage[], marker: PartMarker): number {
  let count = 0
  for (const message of list) {
    for (const item of message?.content ?? []) {
      if (!item) continue
      // Reset on the marker so we count only activity after it.
      if (safeMarker(marker, item)) count = 0
      else if (item.type === "tool") count++
    }
    // Synthetic relays are top-level messages, not content items.
    if (message?.type === "synthetic" && safeMarker(marker, message)) count = 0
  }
  return count
}

function countMatching(list: SessionMessage[], marker: PartMarker): number {
  let count = 0
  for (const message of list) {
    if (message?.type === "synthetic" && safeMarker(marker, message)) count++
    for (const item of message?.content ?? []) {
      if (item && safeMarker(marker, item)) count++
    }
  }
  return count
}

/** A caller-supplied predicate must not be able to throw into a hook. */
function safeMarker(marker: PartMarker, part: MessageContent | SessionMessage): boolean {
  try {
    return marker(part) === true
  } catch {
    return false
  }
}

/**
 * Matches a synthetic message relayed by this plugin, by its fixed
 * description.
 *
 * Necessary for any per-session consult cap. In V1 the equivalent counted
 * `subtask` parts dispatched to the advisor agent by agent AND description;
 * in V2 the consult runs in a separate session and only the relayed synthetic
 * message lands in the reviewed session's history, so the description on that
 * relay is the discriminator. A manual `@advisor` consult creates its own
 * session and never writes this marker into the reviewed session's history.
 */
/**
 * Matches any synthetic message with the given description.
 * Use for "when was this agent last consulted, by anyone" — e.g. resetting a
 * work counter, where a manual consult should reset it just as a
 * plugin-initiated one would, because advice was in fact just given.
 */
export function syntheticMarker(description: string): PartMarker {
  return (part) => (part as SessionMessage)?.type === "synthetic" && (part as SessionMessage)?.description === description
}

/**
 * Assistant tool-content shapes that mean an interrupted/dead subagent run.
 *
 * V1 matched `state.error === "Cancelled"` exactly. V2 tool errors are
 * structured (`error.type` / `error.message`); the interrupt markers surface
 * as abort/cancel in the type or message. Prefix-free matches on the error
 * *type* where available, with the message as fallback.
 */
function isSubtaskCancel(part: MessageContent): boolean {
  if (part?.type !== "tool") return false
  const err = part.state?.error
  if (!err) return false
  const type = String(err.type ?? "")
  const msg = String(err.message ?? "")
  if (/abort|cancel|interrupt/i.test(type)) return true
  // Exact-string interrupt markers observed on the wire; deliberately not a
  // blanket /cancel/ test, which would also match
  // "Tool execution failed: Task cancelled" (a non-interrupt failure path).
  return (
    msg === "Cancelled" ||
    msg === "Task cancelled" ||
    msg === "Tool execution aborted"
  )
}

/**
 * Tool-content error strings that mean the user refused the pending call.
 *
 * Prefix matching, not exact: `"The user rejected permission to use this
 * specific tool call"` has a with-feedback variant that appends text, and the
 * `*Error(` forms cover the raw serialization (`QuestionRejectedError({…})`)
 * alongside the human-readable message.
 */
const USER_REJECTION_PREFIXES = [
  "The user rejected permission to use this specific tool call",
  "The user dismissed this question",
  "PermissionRejectedError(",
  "QuestionRejectedError(",
]

function isUserRejection(part: MessageContent): boolean {
  if (part?.type !== "tool") return false
  const err = part.state?.error
  if (!err) return false
  const type = String(err.type ?? "")
  if (type === "PermissionRejectedError" || type === "QuestionRejectedError") return true
  const msg = String(err.message ?? "")
  if (!msg) return false
  return USER_REJECTION_PREFIXES.some((prefix) => msg.startsWith(prefix))
}

/**
 * Matches a `tool` item whose error says the user rejected or dismissed it.
 *
 * Two families, distinguished by the naming asymmetry in opencode's error
 * classes: `*RejectedError` is a user action (`PermissionRejectedError`,
 * `QuestionRejectedError`), while `PermissionDeniedError` is a config deny
 * rule with no user interaction at all — and 0 of 135 V1 consults were
 * preceded by one, so deny rules are deliberately NOT matched here.
 */
export function userRejectionMarker(): PartMarker {
  return (part) => isUserRejection(part as MessageContent)
}
