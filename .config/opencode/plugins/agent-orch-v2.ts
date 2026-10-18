import { Plugin } from "@opencode/plugin"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { hookEnabled, scopedLog } from "./lib/hooks.ts"
import {
  COMMAND_PLUGINS,
  PREAMBLE_MARKER,
  SKILL_PLUGINS,
  buildPreamble,
  buildTrailer,
  commandTemplate,
  discoverSkills,
  readModelsConfig,
  resolveModels,
  runHookScript,
  summarizeDescription,
  toHookPayloads,
} from "./lib/agent-orch-v2.ts"

/**
 * V2 port of the `claude-agent-orchestration-plugin` (agent-orch) skills,
 * commands, and PreToolUse hooks.
 *
 * The read-only clone lives at `claude-agent-orchestration-plugin/` under
 * this config dir (override with `AGENT_ORCH_ROOT`). This plugin never
 * writes to it.
 *
 * What this plugin does NOT do: register the 28 `agents/orchestrate-*.md`
 * agents. V2 plugins cannot add agents — only `agents/**\/*.md` on disk can.
 * Run `bun scripts/generate-agent-orch-agents.ts` to render them into
 * `~/.config/opencode/agents/agent-orch/`, and re-run it whenever the clone
 * updates.
 *
 * Disable switches (`OPENCODE_DISABLED_HOOKS=<comma-separated ids>`, process-scoped):
 * - `agent-orch:commit-trailer` — the `validate-ai-commit.sh` PreToolUse guard.
 * - `agent-orch:worktree-guard` — the `guard-worktree-writes.sh` PreToolUse guard.
 * - `agent-orch:preamble` — the injected V2 tool-mapping system preamble.
 *
 * Skill and command registration (`ctx.skill.transform` / `ctx.command.transform`)
 * has no such switch: skipping registration mid-session would desync from
 * what the user already sees listed, so it is unconditional once the clone
 * is found.
 */

const ROOT = process.env.AGENT_ORCH_ROOT ?? join(homedir(), ".config", "opencode", "claude-agent-orchestration-plugin")
const GIT_COMMIT_RE = /\bgit\s+commit\b/

export default Plugin.define({
  id: "agent-orch.v2",
  async setup(ctx) {
    const log = scopedLog("agent-orch.v2")

    if (!existsSync(ROOT)) {
      log("warn", `clone not found at ${ROOT} — set AGENT_ORCH_ROOT or clone it there. Registering nothing.`)
      return
    }

    const discovered = discoverSkills(ROOT, SKILL_PLUGINS)

    // --- Skills -----------------------------------------------------------
    //
    // Transforms are replayed on every rebuild (see the module docstring in
    // plugins/lib/agent-orch-v2.ts), so the aggregate-count log is gated to
    // fire once; the add/skip decisions themselves are cheap and idempotent
    // (re-running `editor.get(id)` each time), so they are left unconditional.
    let skillsLogged = false
    await ctx.skill.transform((editor) => {
      let added = 0
      let skippedExisting = 0
      let failed = 0

      for (const skill of discovered.skills) {
        try {
          if (editor.get(skill.id)) {
            skippedExisting++
            continue
          }
          editor.add({
            id: skill.id,
            name: skill.name,
            description: skill.description,
            path: skill.path,
            content: skill.content,
          } as unknown as Parameters<typeof editor.add>[0])
          added++
        } catch (err) {
          failed++
          if (!skillsLogged) {
            log("warn", `failed to add skill ${skill.id}: ${err instanceof Error ? err.message : String(err)}`)
          }
        }
      }

      if (!skillsLogged) {
        skillsLogged = true
        log(
          "info",
          `skills: added ${added}, skipped (already registered) ${skippedExisting}, failed ${failed}, nameless ${discovered.skipped.length}`,
        )
      }
    })

    // --- Commands -----------------------------------------------------------
    //
    // Only the sub-plugins in COMMAND_PLUGINS get slash commands; the rest
    // (codebase-graph-analyzer, meta-orch, vault-orch) are skill-only.
    let commandsLogged = false
    await ctx.command.transform((editor) => {
      const usedForms: string[] = []

      for (const skill of discovered.skills) {
        if (!COMMAND_PLUGINS.includes(skill.plugin)) continue

        const description = skill.description ? summarizeDescription(skill.description) : `Run the ${skill.name} skill`
        const execute = async ({ sessionID, prompt, delivery }: { sessionID: string; prompt: Record<string, unknown>; delivery: unknown }) => {
          const text = commandTemplate(skill.plugin, skill.name, String((prompt as { text?: string }).text ?? ""))
          await (ctx.session as unknown as { prompt: (input: Record<string, unknown>) => Promise<unknown> }).prompt({
            ...prompt,
            sessionID,
            text,
            delivery,
          })
        }

        const colonName = `${skill.plugin}:${skill.dir}`
        try {
          editor.add({ name: colonName, description, execute })
          usedForms.push(colonName)
          continue
        } catch (err) {
          if (!commandsLogged) {
            log("warn", `command "${colonName}" rejected (${err instanceof Error ? err.message : String(err)}); retrying with a dash`)
          }
        }

        const dashName = `${skill.plugin}-${skill.dir}`
        try {
          editor.add({ name: dashName, description, execute })
          usedForms.push(dashName)
        } catch (err) {
          if (!commandsLogged) {
            log("warn", `command "${dashName}" also rejected: ${err instanceof Error ? err.message : String(err)}`)
          }
        }
      }

      if (!commandsLogged) {
        commandsLogged = true
        log("info", `commands: registered ${usedForms.length} (${usedForms.join(", ")})`)
      }
    })

    // --- PreToolUse hooks: commit trailer + worktree guard -----------------
    const commitTrailerEnabled = hookEnabled("agent-orch:commit-trailer")
    const worktreeGuardEnabled = hookEnabled("agent-orch:worktree-guard")

    if (commitTrailerEnabled || worktreeGuardEnabled) {
      const validateScript = join(ROOT, "plugins", "agent-orch", "hooks", "validate-ai-commit.sh")
      const guardScript = join(ROOT, "plugins", "agent-orch", "hooks", "guard-worktree-writes.sh")
      const cwdCache = new Map<string, string>()

      await ctx.tool.hook("execute.before", async (event) => {
        const payloads = toHookPayloads(event.tool, event.input)
        if (payloads.length === 0) return

        let cwd = cwdCache.get(event.sessionID)
        if (cwd === undefined) {
          try {
            const info = await ctx.session.get({ sessionID: event.sessionID })
            cwd = (info as { location?: { directory?: string } })?.location?.directory ?? ctx.location.directory
          } catch {
            cwd = ctx.location.directory
          }
          cwdCache.set(event.sessionID, cwd)
        }

        for (const payload of payloads) {
          const command = typeof payload.tool_input.command === "string" ? payload.tool_input.command : ""

          if (commitTrailerEnabled && payload.tool_name === "Bash" && GIT_COMMIT_RE.test(command)) {
            const result = await runHookScript(validateScript, { ...payload, cwd, harness: "opencode" })
            if (result.outcome === "block") {
              throw new Error(`Blocked by validate-ai-commit.sh: ${result.message}`)
            }
            if (result.outcome === "error") {
              log("warn", `validate-ai-commit.sh failed open: ${result.message}`)
            }
          }

          if (
            worktreeGuardEnabled &&
            (payload.tool_name === "Bash" || payload.tool_name === "Edit" || payload.tool_name === "Write")
          ) {
            const result = await runHookScript(guardScript, { ...payload, cwd, harness: "opencode" })
            if (result.outcome === "block") {
              throw new Error(`Blocked by guard-worktree-writes.sh: ${result.message}`)
            }
            if (result.outcome === "error") {
              log("warn", `guard-worktree-writes.sh failed open: ${result.message}`)
            }
          }
        }
      })
    } else {
      log("info", "commit-trailer and worktree-guard hooks both disabled via OPENCODE_DISABLED_HOOKS")
    }

    // --- Preamble: V2 tool-mapping + model table + commit trailer ---------
    if (hookEnabled("agent-orch:preamble")) {
      const ghUserProc = Bun.spawnSync(["git", "-C", ctx.location.directory, "config", "user.name"])
      const ghUser = ghUserProc.exitCode === 0 ? new TextDecoder().decode(ghUserProc.stdout).trim() : ""
      const models = resolveModels(readModelsConfig(ctx.location.directory))
      const preamble = buildPreamble({
        trailer: buildTrailer(ghUser || "<git user.name not set>", models),
        models,
      })

      await ctx.session.hook("context", (event) => {
        if (!event.system.some((part) => part.type === "text" && part.text?.includes(PREAMBLE_MARKER))) {
          event.system.push({ type: "text", text: preamble })
        }
      })
    } else {
      log("info", "preamble disabled via OPENCODE_DISABLED_HOOKS")
    }
  },
})
