import type { Plugin } from "@opencode-ai/plugin"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

/**
 * Automatic advisor consults on turn completion.
 *
 * opencode has no `Stop` hook, so this uses `session.idle` — which fires once
 * per completed turn — and dispatches the `advisor` subagent via a `subtask`
 * part. That costs one extra main-agent turn, equivalent to Claude's Stop hook.
 *
 * Disable with `/advisor-toggle` (sentinel file below).
 */

const SENTINEL = join(homedir(), ".local", "share", "opencode", "advisor-disabled")
const ADVISOR_AGENT = "advisor"

/**
 * Tool calls in a turn below which a consult isn't worth the round-trip.
 * Matches the original plugin's tuned `advisorMinToolCalls: 5`.
 */
const MIN_TOOL_CALLS = 5

/**
 * Ceiling on consults per session. The consult itself costs one extra
 * main-agent turn, and that turn is where the agent *acts* on the advice —
 * reading files, running `git diff`. Those tool calls re-arm the counter, so
 * without a cap a session can chain consults indefinitely. The original relied
 * on Claude's 8-continuation limit plus `stop_hook_active`; neither exists here.
 */
const MAX_CONSULTS = 3

/**
 * Handoff detection, ported from the original's `SKIP:handoff` guard.
 *
 * Most idles are not completions — they are the agent pausing to ask the user
 * something. Consulting then is pointless: the work is in-flight pending user
 * input. The original validated both heuristics (trailing question mark, and
 * these phrases) against four real over-fires; each caught all four
 * independently. Applied to the last 200 characters only, so a question early
 * in a long answer doesn't suppress a legitimate consult.
 */
const HANDOFF_PHRASES =
  /want me to|let me know|do you want|should i|shall i|would you like|paste back|once you|tell me|your (turn|call)|which .* or /i

function isHandoff(text: string): boolean {
  const tail = text.slice(-200)
  return tail.includes("?") || HANDOFF_PHRASES.test(tail)
}

const PROMPT_HEADER = [
  "Review this session and give a second opinion on the pending decision.",
  "",
  "Verify the load-bearing claims against the live workspace before advising —",
  "read the files, grep for the symbols, run `git status` / `git diff` / `git log`.",
  "Do not advise from the conversation alone.",
  "",
  "Emit a `VERIFY: <what> — <how>` line for anything you could not check read-only.",
  "If the work looks sound, say so plainly rather than inventing problems.",
].join("\n")

export const AdvisorPlugin: Plugin = async ({ client }) => {
  /**
   * Sessions already consulted, keyed to the message count at consult time.
   * Anchor-and-count: a bare boolean would consult once per session ever, and a
   * naive counter would re-fire on every subsequent idle.
   */
  const consultedAt = new Map<string, number>()

  /** Consults dispatched per session, capped by MAX_CONSULTS. */
  const consultCount = new Map<string, number>()

  return {
    event: async ({ event }) => {
      // `event` hooks are invoked un-awaited with no error path, so an async
      // throw here becomes an unhandled rejection. Everything stays inside
      // try/catch.
      try {
        if (event.type !== "session.idle") return
        if (existsSync(SENTINEL)) return

        const sessionID = event.properties.sessionID
        if (!sessionID) return

        const session = await client.session.get({ path: { id: sessionID } })
        const info = session.data
        if (!info) return

        // Root sessions only. The advisor's own idle would otherwise re-trigger
        // the advisor.
        if (info.parentID) return

        if ((consultCount.get(sessionID) ?? 0) >= MAX_CONSULTS) return

        const messages = await client.session.messages({ path: { id: sessionID } })
        const list = messages.data ?? []
        if (!list.length) return

        // Count tool calls since the last advisor dispatch, and capture the
        // final assistant text for the handoff check.
        let toolCalls = 0
        let lastAssistantText = ""
        for (const message of list) {
          const parts = message?.parts ?? []
          for (const part of parts) {
            if (part.type === "subtask" && part.agent === ADVISOR_AGENT) {
              toolCalls = 0
            } else if (part.type === "tool") {
              toolCalls++
            } else if (part.type === "text" && message.info?.role === "assistant" && part.text) {
              lastAssistantText = part.text
            }
          }
        }

        // `session.idle` also fires on ESC/abort. An aborted turn that already
        // made enough tool calls would otherwise trigger a consult on work the
        // user explicitly interrupted — and because the abort writes an error
        // part, the message count grows and the same-count guard below fails
        // open. Check the discriminant directly.
        const last = list[list.length - 1]
        if (last?.info?.role === "assistant" && last.info.error?.name === "MessageAbortedError") return

        // Nothing substantive since the last consult (or since session start).
        if (toolCalls < MIN_TOOL_CALLS) return

        // The agent is pausing to ask the user something, not declaring done.
        if (lastAssistantText && isHandoff(lastAssistantText)) return

        // Don't re-consult at the same message count — `session.idle` can land
        // repeatedly without new work.
        const seen = consultedAt.get(sessionID)
        if (seen !== undefined && seen >= list.length) return

        // Record BEFORE dispatching: the call is async and idle can re-enter.
        consultedAt.set(sessionID, list.length)
        consultCount.set(sessionID, (consultCount.get(sessionID) ?? 0) + 1)

        // A `subtask` part carries only prompt/description/agent — the child
        // session inherits no conversation history, so the advisor would
        // otherwise be reviewing "this session" with no access to it. Name the
        // session explicitly and point it at the workspace it can actually read.
        const prompt = [
          PROMPT_HEADER,
          "",
          `Session under review: ${sessionID} (${toolCalls} tool calls since the last consult).`,
          "You do not receive the conversation history — inspect the workspace directly",
          "to reconstruct what changed, starting from `git status` and `git diff`.",
        ].join("\n")

        await client.session.prompt({
          path: { id: sessionID },
          body: {
            parts: [
              {
                type: "subtask",
                agent: ADVISOR_AGENT,
                description: "Second opinion on the pending decision",
                prompt,
              },
            ],
          },
        })
        // Note: no `noReply` — the field does not exist on SubtaskPartInput, and
        // returning early from the run loop means the subtask part is written to
        // history but never executed.
      } catch (err) {
        console.warn(`[advisor] consult skipped: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
  }
}
