import { Plugin } from "@opencode/plugin"
import { hookEnabled, requireBinary, scopedLog } from "./lib/hooks.ts"

/**
 * Rewrites shell commands through `lean-ctx hook rewrite-inline`, which
 * substitutes compressed equivalents for common shell invocations.
 *
 * Disable with `OPENCODE_DISABLED_HOOKS=lean-ctx:bash-rewrite`.
 */

const HOOK_ID = "lean-ctx:bash-rewrite"

export default Plugin.define({
  id: "lean-ctx",
  async setup(ctx) {
    const log = scopedLog(HOOK_ID)

    // Both gates are checked once, at setup, and the hook is simply not registered
    // when either fails — rather than registering it and short-circuiting per call.
    //
    // This is not merely the cheaper option, it is the only one that can differ:
    // `OPENCODE_DISABLED_HOOKS` is parsed once at module load, and a binary does
    // not appear on PATH mid-process. Re-checking inside `execute.before`
    // could not observe anything this misses, and that path is hot — the current
    // log shows 754 rewritten invocations.
    if (!hookEnabled(HOOK_ID)) {
      log("info", "disabled via OPENCODE_DISABLED_HOOKS")
      return
    }

    if (!(await requireBinary("lean-ctx"))) {
      log("warn", "lean-ctx binary not found in PATH — plugin disabled")
      return
    }

    await ctx.tool.hook("execute.before", async (event) => {
      const tool = String(event.tool ?? "").toLowerCase()
      if (tool !== "bash" && tool !== "shell") return
      const args = event.input
      if (!args || typeof args !== "object") return

      const command = (args as Record<string, unknown>).command
      if (typeof command !== "string" || !command) return
      if (command.startsWith("lean-ctx ")) return

      // The host awaits this callback's promise before executing the tool
      // (adapter.js wraps it in Effect.promise(() => callback(event))), so the
      // rewrite must be awaited right here — a detached IIFE would race and
      // usually lose, letting the tool run the unmodified command.
      try {
        const proc = Bun.spawn(["lean-ctx", "hook", "rewrite-inline", command], {
          stdout: "pipe",
          stderr: "pipe",
        })
        const rewritten = String(await new Response(proc.stdout).text()).trim()
        await proc.exited
        if (proc.exitCode === 0 && rewritten && rewritten !== command) {
          ;(args as Record<string, unknown>).command = rewritten
        }
      } catch {
        // lean-ctx rewrite failed — pass through unchanged.
      }
    })
  },
})
