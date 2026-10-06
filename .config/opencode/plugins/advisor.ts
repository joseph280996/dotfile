import { Plugin } from "@opencode/plugin"
import { homedir } from "node:os"
import { join } from "node:path"
import { hookEnabled, scopedLog, sentinelExists } from "./lib/hooks.ts"
import type { PartMarker } from "./lib/session.ts"
import { readSession, syntheticMarker, userRejectionMarker } from "./lib/session.ts"

/**
 * Automatic advisor consults on turn completion.
 *
 * opencode has no `Stop` hook, so this triggers on turn completion —
 * `session.execution.succeeded` on the current server (verified on v2.0.21),
 * with `session.idle` kept as a compat fallback — and runs the `advisor` agent in a dedicated consult
 * session created via `session.create({ agent: "advisor" })`, dispatched by a
 * `session.prompt`. The resulting advice is relayed back into the reviewed
 * session as a synthetic message.
 *
 * V2 delta vs the V1 `subtask`-part mechanism: the consult session is a
 * separate session (no `parentID` linkage exists in V2), so this plugin marks
 * its own consult sessions with `metadata.source` and skips them, and counts
 * relayed synthetic messages in the parent history as the consult cap marker.
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
 * Metadata tag written on every consult session this plugin creates, and the
 * discriminator used to (a) skip sessions that ARE consults and (b) count this
 * plugin's own consults when capping.
 */
const CONSULT_SOURCE = "opencode:advisor-consult"

/**
 * Description on the relayed synthetic message.
 *
 * Load-bearing, not cosmetic: it is the discriminator that distinguishes this
 * plugin's relayed consults from advice the main agent requested itself.
 * Changing it resets the effective consult count for in-flight sessions.
 */
const CONSULT_DESCRIPTION = "Second opinion on the pending decision"

/** ctx.storage key prefix for the cross-instance consult-dispatch claim. */
const STORAGE_CLAIM_PREFIX = "advisor:claim:"

/**
 * sentinel path. Deliberately under `~/.local/share/`, NOT the opencode config
 * dir, which is a git repo where a sentinel would show up as a dirty file on
 * every status check.
 */
const SENTINEL = join(homedir(), ".local", "share", "opencode", "advisor-disabled")

/**
 * Work-since markers, created once at module load rather than per event. Each
 * call to the factories returns a fresh closure, and the event handler runs
 * fire-and-forget, so per-event construction is churn. The combined predicate
 * is what `toolCallsSince` resets on — resetting on a rejection as well as a
 * consult is load-bearing: the `userRejected` skip guard alone would just
 * defer the over-fire by one turn, because tool calls made before the
 * rejection stay counted and the next turn fires a consult with as few as 0
 * new tool calls. With the combined marker, work is measured since the
 * rejection, and 5 genuinely new tool calls are needed before a consult.
 */
const ADVISOR_SYNTHETIC = syntheticMarker(CONSULT_DESCRIPTION)
const USER_REJECTION = userRejectionMarker()
const WORK_SINCE: PartMarker = (part) => ADVISOR_SYNTHETIC(part) || USER_REJECTION(part)

/**
 * Tool calls in a turn below which a consult isn't worth the round-trip.
 * Matches the original plugin's tuned `advisorMinToolCalls: 5`.
 */
const MIN_TOOL_CALLS = 5

/**
 * Ceiling on consults per session. The consult costs the advisor a full
 * session run, and the relayed advice turn is where the agent *acts* on the
 * advice — reading files, running `git diff`. Those tool calls re-arm the
 * counter, so without a cap a session can chain consults indefinitely. The
 * original relied on Claude's 8-continuation limit plus `stop_hook_active`;
 * neither exists here.
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

export default Plugin.define({
  id: "advisor",
  async setup(ctx) {
    const log = scopedLog(HOOK_ID)

    // Process-scoped switch, checked once. The sentinel below is the
    // live-toggleable one.
    const enabled = hookEnabled(HOOK_ID)
    if (!enabled) log("info", "disabled via OPENCODE_DISABLED_HOOKS")

    /**
     * Message count at the last dispatch, per session. Serves TWO purposes, and
     * both are why it cannot be replaced by state derived from history:
     *
     * 1. **Dedupe.** Completion events can land repeatedly without new work.
     *
     * 2. **Same-turn dedupe.** The consult dispatch runs detached (below), so
     *    the anchor is the only stopper for the NEXT completion event that
     *    arrives while advice is still pending: without it, the repeated
     *    per-turn event deliveries would each re-read history where the
     *    relay had not landed yet and dispatch again. Failing closed (anchor
     *    kept on failure) costs one skipped consult; not keeping it costs an
     *    infinite dispatch loop.
     *
     * Deliberately never released, not even on failure: a released anchor plus
     * a dispatch that failed before the relay was written would leave the
     * derived counter unchanged and still above threshold, re-dispatching
     * immediately and indefinitely. Failing closed is the safer asymmetry — a
     * dispatch failure costs one skipped consult, not a hot loop.
     */
    const dispatchAnchor = new Map<string, number>()

    /**
     * Synchronous per-session in-process mutex. Within one plugin instance,
     * same-turn completion deliveries overlap and must serialize. The
     * CROSS-INSTANCE claim (three plugin instances exist: CLI, server, TUI —
     * each with its own Maps and each subscribed to the bus) uses
     * ctx.storage: set a short-lived claim key before dispatch; other
     * instances see it and skip. See `storageClaimIdle` below.
     */
    const inFlight = new Set<string>()

    const controller = new AbortController()

    void (async () => {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        // Event handling is dispatched fire-and-forget with no error path, so
        // an async throw here becomes an unhandled rejection. Everything stays
        // inside try/catch.
        try {
          if (!enabled) continue
          // Turn completion. v2.0.21 publishes `session.execution.succeeded`
          // (verified live via SSE capture); keep `session.idle` as a compat
          // trigger for builds that still emit it. Failed/interrupted runs are
          // filtered by the turn-state guards below.
          if (event.type !== "session.execution.succeeded" && event.type !== "session.idle") continue

          // Checked per event so `/advisor-toggle` applies without a restart.
          if (sentinelExists(SENTINEL)) continue

          const sessionID = (event.data as { sessionID?: string }).sessionID
          if (!sessionID) continue

          /**
           * SYNC dedupe gate. `session.execution.succeeded` is published
           * repeatedly per turn (verified: 3 deliveries within 65ms), and the
           * handler overlaps itself because deliveries are never awaited.
           * Claim a synchronous in-flight flag BEFORE the first `await` and
           * hold it for the whole handler — including the consult dispatch —
           * so same-turn deliveries serialize instead of all passing the
           * later, async dispatchAnchor check.
           */
          if (inFlight.has(sessionID)) continue
          inFlight.add(sessionID)
          // Set once we hand off to dispatchConsult, whose own `.finally()`
          // then owns the release. Every other exit from this try — a
          // `continue` on a skip guard, or a thrown error — never sets this,
          // so the outer `finally` below releases immediately instead of
          // leaking the claim. `continue` does not run a sibling `catch`
          // block, only `finally`, which is why release lives there and not
          // in the `catch` below.
          let dispatched = false
          try {
            // Skip this plugin's own consult sessions — the advisor's own
            // completion would otherwise re-trigger the advisor.
            let isConsult = false
            try {
              const info = await ctx.session.get({ sessionID })
              isConsult = (info as { metadata?: Record<string, unknown> }).metadata?.source === CONSULT_SOURCE
            } catch {
              continue
            }
            if (isConsult) continue

            // Rejects consult and subagent sessions before fetching messages.
            const result = await readSession(ctx, sessionID)
            if (!result.ok) continue
            const facts = result.facts

            // A turn that ended in an error is not a completion, even if it
            // did enough work. Independent checks: message-level error, an
            // incomplete turn (completion raced the persist), and a user
            // rejection.
            if (facts.turnErrored) continue
            if (facts.turnIncomplete) {
              log("info", "skipped: turn incomplete (idle raced the abort persist)")
              continue
            }
            if (facts.subtaskCancelled) {
              log("info", "skipped: subtask cancelled mid-run")
              continue
            }
            if (facts.userRejected) {
              log("info", "skipped: user rejected the pending tool call")
              continue
            }

            // Count only this plugin's own relays. A synthetic message with
            // the fixed CONSULT_DESCRIPTION is written for every consult this
            // plugin relays; manual `@advisor` consults are separate sessions
            // and never write this marker into the reviewed session.
            if (facts.countMatching(ADVISOR_SYNTHETIC) >= MAX_CONSULTS) continue

            // Work done since the last consult relay or rejection. Resetting
            // on a manual consult is intended: advice was just given, so the
            // counter starts over. Resetting on a rejection is load-bearing —
            // see the `WORK_SINCE` note above.
            const toolCalls = facts.toolCallsSince(WORK_SINCE)
            if (toolCalls < MIN_TOOL_CALLS) continue

            // The agent is pausing to ask the user something, not done.
            if (facts.lastAssistantText) {
              if (isGrillingRound(facts.lastAssistantText)) {
                log("info", "skipped: grilling round awaiting user answers")
                continue
              }
              if (isHandoff(facts.lastAssistantText)) continue
            }

            // Don't re-consult at the same message count.
            const seen = dispatchAnchor.get(sessionID)
            if (seen !== undefined && seen >= facts.messageCount) continue

            // Record BEFORE dispatching — see the `dispatchAnchor` note above.
            dispatchAnchor.set(sessionID, facts.messageCount)

            // A consult session does not inherit conversation history, so
            // name the reviewed session explicitly and instruct the advisor
            // to inspect it directly.
            const prompt = [
              PROMPT_HEADER,
              "",
              `Session under review: ${sessionID} (${toolCalls} tool calls since the last consult).`,
              "You do not receive the conversation history — inspect the workspace directly",
              "to reconstruct what changed, starting from `git status` and `git diff`.",
            ].join("\n")

            // Mutex released when the detached dispatch settles. Later
            // same-turn deliveries then pass the in-flight gate again but are
            // stopped by the dispatchAnchor (same message count) and, once the
            // relay lands, by MAX_CONSULTS and WORK_SINCE.
            dispatched = true
            void dispatchConsult(
              (ctx as unknown as { session: ConsultSessionApi }).session,
              (ctx as unknown as { storage: StorageDomain }).storage,
              sessionID,
              prompt,
              log,
            ).finally(() => {
              inFlight.delete(sessionID)
            })
          } catch (err) {
            log("warn", `consult skipped: ${err instanceof Error ? err.message : String(err)}`)
          } finally {
            if (!dispatched) inFlight.delete(sessionID)
          }
        } catch (err) {
          log("warn", `consult skipped: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    })()

    return () => controller.abort()
  },
})


/**
 * Create the consult session, run the advisor, wait, and relay the final
 * advice text back into the reviewed session as a synthetic message.
 *
 * All failures are caught and logged: a failed consult costs a skipped
 * notification, never the parent session.
 */
type ConsultSessionApi = {
  create: (input: { title?: string; agent?: string; metadata?: Record<string, unknown> }) => Promise<{ id: string } | SessionCreateWrap>
  prompt: (input: { sessionID: string; text: string }) => Promise<unknown>
  wait: (input: { sessionID: string }) => Promise<void>
  remove: (input: { sessionID: string }) => Promise<unknown>
  context: (input: { sessionID: string }) => Promise<Array<{ type?: string; agent?: string; content?: Array<{ type?: string; text?: string }>; error?: unknown; time?: { completed?: number } }>>
  synthetic: (input: { sessionID: string; text: string; description?: string; metadata?: Record<string, unknown> }) => Promise<unknown>
}

/** Durable plugin storage (shared across plugin instances). */
type StorageDomain = {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
}

/** The client wraps session payloads in `{ data }` on some entrypoints. */
type SessionCreateWrap = { data: { id: string } }

async function dispatchConsult(
  session: ConsultSessionApi,
  storage: StorageDomain,
  parentSessionID: string,
  prompt: string,
  log: (level: "debug" | "info" | "warn" | "error", message: string) => void,
): Promise<void> {
  try {
    const consult = await session.create({
      title: "Advisor consult",
      agent: ADVISOR_AGENT,
      metadata: { source: CONSULT_SOURCE, reviewSessionID: parentSessionID },
    })
    const consultID = typeof (consult as SessionCreateWrap).data?.id === "string"
      ? (consult as SessionCreateWrap).data.id
      : (consult as { id: string }).id

    // Claim phase. Three plugin instances race the same turn and storage has
    // no compare-and-swap, so the claim is two-phase around session.create:
    // first instance to record its consult ID owns the run. Losers delete
    // their own (empty, never-prompted) consult session and bail — saving the
    // expensive advisor run. The relay-side MAX_CONSULTS count remains the
    // backstop for storage-less environments.
    const claimKey = STORAGE_CLAIM_PREFIX + parentSessionID
    try {
      const prior = (await storage.get(claimKey)) as { consultID?: string } | undefined
      if (prior?.consultID && prior.consultID !== consultID) {
        // The plugin SDK's session domain has no remove/delete (verified in
        // @opencode/plugin@2.0.20 adapter.js — only hook/create/get/switch*/
        // prompt/generate/command/synthetic/interrupt/update/move/wait/context),
        // so the losing session cannot be deleted. Abandon it unprompted: no
        // advisor run happens, and relay-side MAX_CONSULTS bounds the clutter.
        log("info", "lost dispatch race — duplicate consult session abandoned, not prompted")
        return
      }
      await storage.set(claimKey, { consultID })
    } catch {
      // Storage unavailable: proceed; relay-side MAX_CONSULTS still dedupes.
    }

    await session.prompt({ sessionID: consultID, text: prompt })
    await session.wait({ sessionID: consultID })

    const messages = await session.context({ sessionID: consultID })
    let advice = ""
    for (const m of messages) {
      if (m?.type !== "assistant" || m?.agent !== ADVISOR_AGENT) continue
      if (m.error != null || !m.time?.completed) continue
      for (const part of m.content ?? []) {
        if (part?.type === "text" && part.text) advice = part.text
      }
    }
    if (!advice) {
      log("warn", "consult produced no advice text — nothing relayed")
      return
    }

    // Relay into the reviewed session so the main agent sees the second
    // opinion in-line. metadata tags the relay; description is the marker the
    // consult cap counts.
    await session.synthetic({
      sessionID: parentSessionID,
      description: CONSULT_DESCRIPTION,
      text: advice.slice(0, 8000),
      metadata: { source: CONSULT_SOURCE, consultSessionID: consultID },
    })
  } catch (err) {
    log("warn", `consult dispatch failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}
