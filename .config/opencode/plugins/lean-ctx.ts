import type { Plugin } from "@opencode-ai/plugin"
import { hookEnabled, requireBinary, scopedLog } from "./lib/hooks.ts"

/**
 * Rewrites bash commands through `lean-ctx hook rewrite-inline`, which
 * substitutes compressed equivalents for common shell invocations.
 *
 * Disable with `OPENCODE_DISABLED_HOOKS=lean-ctx:bash-rewrite`.
 */

const HOOK_ID = "lean-ctx:bash-rewrite"

export const LeanCtxOpenCodePlugin: Plugin = async ({ $ }) => {
  const log = scopedLog(HOOK_ID)

  // Both gates are checked once, at init, and the hook is simply not registered
  // when either fails — rather than registering it and short-circuiting per call.
  //
  // This is not merely the cheaper option, it is the only one that can differ:
  // `OPENCODE_DISABLED_HOOKS` is parsed once at module load, and a binary does
  // not appear on PATH mid-process. Re-checking inside `tool.execute.before`
  // could not observe anything this misses, and that path is hot — the current
  // log shows 754 rewritten invocations.
  if (!hookEnabled(HOOK_ID)) {
    log("info", "disabled via OPENCODE_DISABLED_HOOKS")
    return {}
  }

  if (!(await requireBinary("lean-ctx", $))) {
    log("warn", "lean-ctx binary not found in PATH — plugin disabled")
    return {}
  }

  return {
    "tool.execute.before": async (input, output) => {
      const tool = String(input?.tool ?? "").toLowerCase()
      if (tool !== "bash" && tool !== "shell") return
      const args = output?.args
      if (!args || typeof args !== "object") return

      const command = (args as Record<string, unknown>).command
      if (typeof command !== "string" || !command) return
      if (command.startsWith("lean-ctx ")) return

      try {
        const result = await $`lean-ctx hook rewrite-inline ${command}`.quiet().nothrow()
        const rewritten = String(result.stdout).trim()
        if (rewritten && rewritten !== command) {
          ;(args as Record<string, unknown>).command = rewritten
        }
      } catch {
        // lean-ctx rewrite failed — pass through unchanged.
      }
    },
  }
}
