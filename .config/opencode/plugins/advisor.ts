import type { Plugin } from "@opencode-ai/plugin"
import { homedir } from "node:os"
import { join } from "node:path"
import { hookEnabled, scopedLog, sentinelExists } from "./lib/hooks.ts"
import { pluginSubtaskMarker, readSession, subtaskMarker } from "./lib/session.ts"

/**
 * Automatic advisor consults on turn completion.
 *
 * opencode has no `Stop` hook, so this uses `session.idle` — which fires once
 * per completed turn — and dispatches the `advisor` subagent via a `subtask`
 * part. That costs one extra main-agent turn, equivalent to Claude's Stop hook.
 *
 * Two independent kill switches, with different reach:
 * - `/advisor-toggle` writes the sentinel file below. Checked per event, so it
 *   takes effect immediately, without restarting opencode.
 * - `OPENCODE_DISABLED_HOOKS=advisor:consult` is process-scoped (parsed once at
 *   module load), so it needs a restart. Suited to CI or a one-off invocation.
 */

const HOOK_ID = "advisor:consult"
const ADVISOR_AGENT = "advisor"

/**
 * Sentinel path. Deliberately under `~/.local/share/`, NOT the opencode config
 * dir, which is a git repo where a sentinel would show up as a dirty file on
 * every status check.
 */
const SENTINEL = join(homedir(), ".local", "share", "opencode", "advisor-disabled")

/**
 * Description on the dispatched subtask part.
 *
 * Load-bearing, not cosmetic: it is the discriminator that distinguishes this
 * plugin's consults from ones the main agent dispatches itself. Changing it
 * resets the effective consult count for in-flight sessions.
 */
const CONSULT_DESCRIPTION = "Second opinion on the pending decision"

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
 * independently.
 */
const HANDOFF_PHRASES =
  /want me to|let me know|do you want|should i|shall i|would you like|paste back|once you|tell me|your (turn|call)|which .* or /i

/**
 * Grilling rounds end on a declarative recommendation, so the handoff
 * heuristics below never see a question — the `❓` markers sit thousands of
 * characters above the tail, and each one is answered by a `➡️` statement.
 *
 * Requires BOTH markers. `❓` alone is not a grilling signal: resiliency-review
 * uses it as a row-level confidence value ("❓ Unknown / needs verification") on
 * reports that legitimately complete work and should still be consulted on.
 * `➡️` is unique to grilling across every installed skill directory.
 */
const GRILL_RECOMMENDATION = "➡️"
const GRILL_QUESTION = /❓|\*\*Q\d+\*\*/

function isGrillingRound(text: string): boolean {
  return text.includes(GRILL_RECOMMENDATION) && GRILL_QUESTION.test(text)
}

function isHandoff(text: string): boolean {
  // Whole-text scan: a question early in a long answer is still a question.
  // A tail-only window is what let grilling rounds through — each one closes
  // on a declarative `➡️` recommendation, never a `?`.
  if (text.includes("?")) return true
  // Phrases stay tail-scoped — they are weak signals that only carry
  // handoff meaning when they are how the message ends.
  return HANDOFF_PHRASES.test(text.slice(-200))
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
  const log = scopedLog(HOOK_ID)

  // Process-scoped switch, checked once. The sentinel below is the
  // live-toggleable one.
  const enabled = hookEnabled(HOOK_ID)
  if (!enabled) log("info", "disabled via OPENCODE_DISABLED_HOOKS")

  /**
   * Message count at the last dispatch, per session. Serves TWO purposes, and
   * both are why it cannot be replaced by state derived from history:
   *
   * 1. **Dedupe.** `session.idle` can land repeatedly without new work.
   *
   * 2. **In-flight mutex.** `client.session.prompt` blocks until the dispatched
   *    advisor turn *finishes*, and that turn ending publishes another
   *    `session.idle`. Plugin events are dispatched fire-and-forget (the
   *    handler's promise is never awaited), so this handler reliably overlaps
   *    with itself. Recording synchronously before the first `await` is what
   *    stops a second invocation from dispatching a duplicate consult.
   *
   * Deliberately never released, not even on failure: a released guard plus a
   * dispatch that failed before writing its subtask part would leave the derived
   * counter unchanged and still above threshold, re-dispatching immediately and
   * indefinitely. Failing closed for a given message count is the safer
   * asymmetry — a dispatch failure costs one skipped consult, not a hot loop.
   */
  const dispatchAnchor = new Map<string, number>()

  return {
    event: async ({ event }) => {
      // `event` hooks are invoked un-awaited with no error path, so an async
      // throw here becomes an unhandled rejection. Everything stays inside
      // try/catch.
      try {
        if (!enabled) return
        if (event.type !== "session.idle") return

        // Checked per event so `/advisor-toggle` applies without a restart.
        if (sentinelExists(SENTINEL)) return

        const sessionID = event.properties.sessionID
        if (!sessionID) return

        // Rejects subagent sessions before fetching messages — the advisor's own
        // idle would otherwise re-trigger the advisor.
        const result = await readSession(client, sessionID)
        if (!result.ok) return
        const facts = result.facts

        // An aborted turn is not a completion, even if it did enough work.
        // Three independent checks, because ESC has three distinct code paths
        // in opencode's session runtime that each race, or skip, the message-
        // level `error` field differently — see the doc comments on each fact
        // in lib/session.ts for the exact opencode source lines.
        if (facts.wasAborted) return
        if (facts.turnIncomplete) {
          log("info", "skipped: turn incomplete (idle raced the abort persist)")
          return
        }
        if (facts.subtaskCancelled) {
          log("info", "skipped: subtask cancelled mid-run")
          return
        }

        // Count only this plugin's own dispatches. A `subtask` part is written
        // for every subagent invocation, including manual `@advisor` consults,
        // and counting those would exhaust the budget before the plugin fired.
        if (facts.countMatching(pluginSubtaskMarker(ADVISOR_AGENT, CONSULT_DESCRIPTION)) >= MAX_CONSULTS) {
          return
        }

        // Work done since the last consult by anyone. Resetting on a manual
        // consult is intended: advice was just given, so the counter should
        // start over regardless of who asked for it.
        const toolCalls = facts.toolCallsSince(subtaskMarker(ADVISOR_AGENT))
        if (toolCalls < MIN_TOOL_CALLS) return

        // The agent is pausing to ask the user something, not declaring done.
        if (facts.lastAssistantText) {
          if (isGrillingRound(facts.lastAssistantText)) {
            log("info", "skipped: grilling round awaiting user answers")
            return
          }
          if (isHandoff(facts.lastAssistantText)) return
        }

        // Don't re-consult at the same message count.
        const seen = dispatchAnchor.get(sessionID)
        if (seen !== undefined && seen >= facts.messageCount) return

        // Record BEFORE dispatching — see the `dispatchAnchor` note above.
        dispatchAnchor.set(sessionID, facts.messageCount)

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
                description: CONSULT_DESCRIPTION,
                prompt,
              },
            ],
          },
        })
        // Note: no `noReply` — the field does not exist on SubtaskPartInput, and
        // returning early from the run loop means the subtask part is written to
        // history but never executed.
      } catch (err) {
        log("warn", `consult skipped: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
  }
}
