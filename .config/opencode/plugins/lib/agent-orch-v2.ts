/**
 * Pure helpers for the agent-orch V2 port (plugins/agent-orch-v2.ts).
 *
 * Everything here is synchronous and side-effect free except `runHookScript`,
 * which spawns the V1 hook scripts shipped in the read-only clone at
 * `claude-agent-orchestration-plugin/plugins/agent-orch/hooks/`. Keeping the
 * pure logic separate from the plugin file is what makes it testable with
 * `bun test` without booting the opencode runtime, and is required anyway:
 * opencode's plugin discovery type-checks every export of every top-level
 * `plugins/*.ts` file, so only the `Plugin.define(...)` default export may
 * live there — everything else (including these `const`/`type`/`function`
 * exports) must live under `plugins/lib/`.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

/** Path prefix V2 agent IDs get from their directory (`agents/agent-orch/<name>.md`). */
export const AGENT_DIR_PREFIX = "agent-orch/"

/** Marker line that opens every injected preamble, so re-injection can be detected and skipped. */
export const PREAMBLE_MARKER = "<!-- agent-orch.v2 preamble -->"

/** Sub-plugins that ship `skills/<dir>/SKILL.md` content. */
export const SKILL_PLUGINS = ["agent-orch", "codebase-graph-analyzer", "meta-orch", "scout", "team-work", "vault-orch"]

/** Sub-plugins whose skills are also registered as slash commands. */
export const COMMAND_PLUGINS = ["agent-orch", "scout", "team-work"]

const FRONTMATTER_RE = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/

export interface Frontmatter {
  data: Record<string, string>
  body: string
}

/**
 * Minimal YAML-frontmatter reader: top-level `key: value` scalars only.
 *
 * Indented lines (nested maps) and `#`-comment lines are skipped rather than
 * mis-parsed. One pair of matching surrounding quotes is stripped from the
 * value, matching how `description: "..."` and `description: '...'` show up
 * across the clone's skills and agents.
 */
export function parseFrontmatter(text: string): Frontmatter {
  const match = FRONTMATTER_RE.exec(text)
  if (!match) return { data: {}, body: text }

  const data: Record<string, string> = {}
  for (const line of match[1]!.split(/\r?\n/)) {
    if (line === "" || /^\s/.test(line) || /^\s*#/.test(line)) continue
    const colon = line.indexOf(":")
    if (colon === -1) continue
    const key = line.slice(0, colon).trim()
    if (!key) continue
    let value = line.slice(colon + 1).trim()
    if (value.length >= 2) {
      const first = value[0]
      const last = value[value.length - 1]
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        value = value.slice(1, -1)
      }
    }
    data[key] = value
  }

  const body = text.slice(match[0].length).replace(/^\r?\n+/, "")
  return { data, body }
}

const AGENT_HANDLE_RE = /agent-orch:(orchestrate-[a-z0-9-]+)/g

/** Rewrites `agent-orch:orchestrate-<x>` dispatch handles to the V2 agent ID `agent-orch/orchestrate-<x>`. */
export function rewriteAgentHandles(text: string): string {
  return text.replace(AGENT_HANDLE_RE, `${AGENT_DIR_PREFIX}$1`)
}

const LEAN_CTX_WRAP_RE = /^(?:\S*\/)?lean-ctx -c '([\s\S]*)'$/

/** Undoes the `lean-ctx -c '<cmd>'` rewrite (see plugins/lean-ctx.ts) so hooks see the real command. */
export function unwrapLeanCtx(cmd: string): string {
  const match = LEAN_CTX_WRAP_RE.exec(cmd)
  if (!match) return cmd
  return match[1]!.replaceAll("'\\''", "'")
}

const PATCH_HEADER_RE = /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.*)$/

/** Extracts every file path touched by a `patch` tool's `patchText`, in document order. */
export function extractPatchPaths(patchText: string): string[] {
  const paths: string[] = []
  for (const line of patchText.split(/\r?\n/)) {
    const match = PATCH_HEADER_RE.exec(line)
    if (match) paths.push(match[1]!.trim())
  }
  return paths
}

export interface HookPayload {
  tool_name: string
  tool_input: Record<string, unknown>
}

/**
 * Translates a V2 `execute.before` event's `(tool, input)` into the
 * Claude-shaped `{tool_name, tool_input}` payloads the V1 hook scripts
 * expect on stdin. One tool call can expand into several payloads (`patch`
 * touching multiple files becomes one `Edit` payload per file) because the
 * scripts only ever look at one file/command per invocation.
 */
export function toHookPayloads(tool: string, input: unknown): HookPayload[] {
  if (!input || typeof input !== "object") return []
  const record = input as Record<string, unknown>

  if (tool === "shell" || tool === "bash") {
    if (typeof record.command !== "string") return []
    return [{ tool_name: "Bash", tool_input: { command: unwrapLeanCtx(record.command) } }]
  }

  if (tool === "edit" || tool === "write") {
    const filePath = record.path ?? record.filePath ?? record.file_path
    if (typeof filePath !== "string" || !filePath) return []
    return [
      {
        tool_name: tool === "edit" ? "Edit" : "Write",
        tool_input: { ...record, file_path: filePath },
      },
    ]
  }

  if (tool === "patch") {
    if (typeof record.patchText !== "string") return []
    return extractPatchPaths(record.patchText).map((file_path) => ({
      tool_name: "Edit",
      tool_input: { file_path },
    }))
  }

  return []
}

export interface ModelAliases {
  opus: string
  sonnet: string
  haiku: string
}

const DEFAULT_MODELS: ModelAliases = {
  opus: "SSC/us.anthropic.claude-opus-5-5",
  sonnet: "SSC/us.anthropic.claude-sonnet-5-5",
  haiku: "SSC/us.anthropic.claude-haiku-4-5-20251001-v1:0",
}

export interface ModelsConfig {
  aliases?: Partial<Record<string, string>>
  commit_attribution?: { harness?: string }
}

/**
 * Reads `.agent-orch-models.json`, project config first then global —
 * matching the four-tier resolution `validate-ai-commit.sh` and the V1
 * plugin both use.
 */
export function readModelsConfig(dir: string): ModelsConfig | undefined {
  const candidates = [join(dir, ".agent-orch-models.json"), join(homedir(), ".config", "agent-orch-models.json")]
  for (const path of candidates) {
    try {
      if (!existsSync(path)) continue
      return JSON.parse(readFileSync(path, "utf8")) as ModelsConfig
    } catch {
      // Malformed config at this tier — fall through to the next.
    }
  }
  return undefined
}

/**
 * Resolves the opus/sonnet/haiku aliases, overriding each default only when
 * the config supplies a QUALIFIED model id (containing `/`) — a bare alias
 * like `"sonnet"` is the V1 Claude Code shorthand, not a usable V2 model id,
 * so it is ignored rather than propagated.
 */
export function resolveModels(cfg?: ModelsConfig): ModelAliases {
  const aliases = cfg?.aliases ?? {}
  const resolve = (key: keyof ModelAliases): string => {
    const override = aliases[key]
    return typeof override === "string" && override.includes("/") ? override : DEFAULT_MODELS[key]
  }
  return { opus: resolve("opus"), sonnet: resolve("sonnet"), haiku: resolve("haiku") }
}

/**
 * Renders a V1 Claude Code agent (`agents/orchestrate-*.md`) as a V2 agent
 * file: frontmatter is replaced wholesale (no `tools:` list — V2 agents
 * cannot restrict tools that way) and `agent-orch:orchestrate-*` handles in
 * the body are rewritten to V2 IDs.
 */
export function renderAgent(source: string, models: ModelAliases): string {
  const { data, body } = parseFrontmatter(source)
  const lines = ["---", "# Generated by scripts/generate-agent-orch-agents.ts. Do not edit; re-run the generator."]
  if (data.description) lines.push(`description: ${JSON.stringify(data.description)}`)
  lines.push("mode: subagent")

  const alias = data.model
  if (alias) {
    const resolved = (models as unknown as Record<string, string>)[alias] ?? (alias.includes("/") ? alias : undefined)
    if (resolved) lines.push(`model: ${resolved}`)
  }

  lines.push("---", "")
  return lines.join("\n") + rewriteAgentHandles(body)
}

/**
 * The `Co-authored-by:` trailer `validate-ai-commit.sh`'s `TRAILER_REGEX`
 * accepts: `<name> + <harness>/<models> <<name>@users.noreply.github.com>`,
 * with no whitespace inside the `harness/models` segment (the regex matches
 * it as `\S+`).
 */
export function buildTrailer(ghUser: string, models: ModelAliases, harness = "opencode"): string {
  return `Co-authored-by: ${ghUser} + ${harness}/${models.opus},${models.sonnet} <${ghUser}@users.noreply.github.com>`
}

const SENTENCE_END_RE = /[.!?]\s/g

/**
 * Port of the V1 plugin's command-description summarizer: collapse
 * whitespace, then if still over 160 chars, cut at the best available
 * boundary (a sentence end at or after index 60, else a space after index
 * 40) and append an ellipsis.
 */
export function summarizeDescription(desc: string): string {
  const collapsed = desc.replace(/\s+/g, " ").trim()
  if (collapsed.length <= 160) return collapsed

  const window = collapsed.slice(0, 160)
  let cut = -1
  let match: RegExpExecArray | null
  SENTENCE_END_RE.lastIndex = 0
  while ((match = SENTENCE_END_RE.exec(window))) {
    const end = match.index + 1 // keep the sentence-ending punctuation, drop the trailing space
    if (end >= 60) cut = end
  }
  if (cut !== -1) return window.slice(0, cut)

  const lastSpace = window.lastIndexOf(" ")
  if (lastSpace > 40) return `${window.slice(0, lastSpace)}…`

  return `${window}…`
}

/** Prompt text a registered command's `execute` forwards to `ctx.session.prompt`. */
export function commandTemplate(plugin: string, skillName: string, args: string): string {
  return [
    `Load the \`${skillName}\` skill of the \`${plugin}\` plugin via the \`skill\` tool and follow it exactly.`,
    "",
    `Arguments: ${args || "(none)"}`,
  ].join("\n")
}

export interface PreambleInput {
  trailer: string
  models: ModelAliases
}

/**
 * System-prompt preamble injected via `ctx.session.hook("context", ...)`.
 *
 * The skills and agents under review were written for Claude Code's tool
 * names and subagent dispatch; this preamble is what makes their prose
 * (`Task`, `TodoWrite`, `subagent_type: "general-purpose"`, ...) resolve to
 * the right V2 tool calls without editing 83 skill files and 28 agent files
 * by hand.
 */
export function buildPreamble({ trailer, models }: PreambleInput): string {
  return [
    PREAMBLE_MARKER,
    "",
    "## agent-orch V2 tool mapping",
    "",
    "The agent-orch skills and agents below were written for Claude Code tool names.",
    "This harness is OpenCode V2. Map every reference as follows:",
    "",
    "- `Bash` -> the `shell` tool",
    "- `Write` -> the `write` tool",
    "- `Edit` / `MultiEdit` / `NotebookEdit` -> the `edit` tool (or `patch` for multi-file changes)",
    "- `Read` -> the `read` tool",
    "- `Grep` -> the `grep` tool; `Glob` -> the `glob` tool",
    "- `WebFetch` -> the `webfetch` tool",
    "- `Task` or \"Subagent (general-purpose)\" -> the `subagent` tool. Use the agent ID: specialist",
    `  dispatches are \`${AGENT_DIR_PREFIX}orchestrate-<name>\`, general-purpose work is \`general\`.`,
    "- Invoking a skill -> the `skill` tool.",
    "- There is no todo tool in this harness. Track plans in a markdown file instead.",
    "",
    "## Agent models",
    "",
    `| alias | model |`,
    `| --- | --- |`,
    `| opus | ${models.opus} |`,
    `| sonnet | ${models.sonnet} |`,
    `| haiku | ${models.haiku} |`,
    "",
    "## Required commit trailer",
    "",
    "Every commit an agent makes under agent-orch must carry:",
    "",
    trailer,
    "",
    "## Entry points",
    "",
    "`/agent-orch:brainstorm` -> `/agent-orch:build`, `/agent-orch:bugfix`, `/agent-orch:make`, `/agent-orch:config`",
    "",
  ].join("\n")
}

export interface DiscoveredSkill {
  plugin: string
  dir: string
  id: string
  name: string
  description?: string
  path: string
  content: string
}

export interface DiscoverSkillsResult {
  skills: DiscoveredSkill[]
  skipped: string[]
}

/**
 * Scans `root/plugins/<plugin>/skills/<dir>/SKILL.md` for every plugin name
 * given, in order. A skill directory with no frontmatter `name:` lands in
 * `skipped` instead of `skills` — the plugin registration path (see
 * plugins/agent-orch-v2.ts) refuses to guess an ID for it.
 */
export function discoverSkills(root: string, pluginNames: string[]): DiscoverSkillsResult {
  const skills: DiscoveredSkill[] = []
  const skipped: string[] = []

  for (const plugin of pluginNames) {
    const skillsDir = join(root, "plugins", plugin, "skills")
    let entries: string[]
    try {
      entries = readdirSync(skillsDir)
    } catch {
      continue
    }

    for (const dir of entries) {
      const skillPath = join(skillsDir, dir, "SKILL.md")
      let raw: string
      try {
        if (!statSync(skillPath).isFile()) continue
        raw = readFileSync(skillPath, "utf8")
      } catch {
        continue
      }

      const { data, body } = parseFrontmatter(raw)
      const name = data.name
      if (!name) {
        skipped.push(skillPath)
        continue
      }

      skills.push({
        plugin,
        dir,
        id: name,
        name,
        description: data.description,
        path: skillPath,
        content: rewriteAgentHandles(body),
      })
    }
  }

  return { skills, skipped }
}

export type HookOutcome = { outcome: "allow" } | { outcome: "block" | "error"; message: string }

/**
 * Runs one of the V1 Bash hook scripts (`validate-ai-commit.sh`,
 * `guard-worktree-writes.sh`) with the given JSON payload on stdin.
 *
 * Never throws: a spawn error, a non-{0,2} exit, or a timeout all come back
 * as `{outcome: "error"}` so the caller (plugins/agent-orch-v2.ts) can fail
 * open, matching this config's hooks.ts policy.
 */
export async function runHookScript(
  scriptPath: string,
  payload: unknown,
  timeoutMs = 10000,
): Promise<HookOutcome> {
  try {
    const proc = Bun.spawn(["bash", scriptPath], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    })

    proc.stdin.write(JSON.stringify(payload))
    proc.stdin.end()

    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      proc.kill()
    }, timeoutMs)

    let exitCode: number
    try {
      exitCode = await proc.exited
    } finally {
      clearTimeout(timer)
    }

    // A killed script's own grandchildren (e.g. a `sleep` it shelled out to)
    // can hold the stdout/stderr pipes open well past the kill, since killing
    // the direct child does not kill its children. Reading those streams on
    // the timeout path would block on exactly the delay this branch exists to
    // avoid, so skip it — the timeout outcome never needed that output.
    if (timedOut) return { outcome: "error", message: "hook script timed out" }

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])

    if (exitCode === 0) return { outcome: "allow" }
    if (exitCode === 2) return { outcome: "block", message: stderr.trim() || stdout.trim() }
    return { outcome: "error", message: `hook script exited ${exitCode}: ${stderr.trim() || stdout.trim()}` }
  } catch (err) {
    return { outcome: "error", message: err instanceof Error ? err.message : String(err) }
  }
}
