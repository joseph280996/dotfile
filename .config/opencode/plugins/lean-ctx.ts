import { accessSync } from "node:fs"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { Plugin } from "@opencode/plugin"

const run = promisify(execFile)
const binary = "/opt/homebrew/bin/lean-ctx"

export default Plugin.define({
  id: "lean-ctx",
  async setup(ctx) {
    try {
      accessSync(binary)
    } catch {
      console.warn("[lean-ctx] binary not found at " + binary + " — plugin disabled")
      return
    }

    // Rewriting happens in the shell create hook, after the permission check
    // has matched the original text, so allow rules like "ls *" keep matching.
    await ctx.shell.hook("create.before", async (event) => {
      const command = event.command
      if (!command || command.includes("lean-ctx ")) return
      try {
        const result = await run(binary, ["hook", "rewrite-inline", command], { timeout: 2000 })
        const rewritten = String(result.stdout).trim()
        if (rewritten && rewritten !== command) event.command = rewritten
      } catch {
        // rewrite failed — run the command unchanged
      }
    })
  },
})
