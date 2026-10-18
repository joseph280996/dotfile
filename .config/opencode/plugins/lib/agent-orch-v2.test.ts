import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  AGENT_DIR_PREFIX,
  PREAMBLE_MARKER,
  buildPreamble,
  buildTrailer,
  commandTemplate,
  discoverSkills,
  extractPatchPaths,
  parseFrontmatter,
  renderAgent,
  resolveModels,
  rewriteAgentHandles,
  runHookScript,
  summarizeDescription,
  toHookPayloads,
  unwrapLeanCtx,
} from "./agent-orch-v2.ts"

describe("parseFrontmatter", () => {
  test("parses top-level scalars, unquotes values, and returns the body", () => {
    const md = `---\nname: brainstorm\ndescription: "Design before code. Usage: /agent-orch:brainstorm"\n---\n\n# Body\n`
    const { data, body } = parseFrontmatter(md)
    expect(data.name).toBe("brainstorm")
    expect(data.description).toBe("Design before code. Usage: /agent-orch:brainstorm")
    expect(body).toBe("# Body\n")
  })

  test("returns empty data and the whole text when there is no frontmatter", () => {
    const { data, body } = parseFrontmatter("# Just a body\n")
    expect(data).toEqual({})
    expect(body).toBe("# Just a body\n")
  })

  test("ignores nested (indented) keys", () => {
    const { data } = parseFrontmatter(`---\nname: x\nmeta:\n  name: nested\n---\nb`)
    expect(data.name).toBe("x")
  })
})

describe("rewriteAgentHandles", () => {
  test("rewrites colon agent handles to the path-derived V2 IDs", () => {
    const text = 'subagent_type: "agent-orch:orchestrate-database" and `agent-orch:orchestrate-api`'
    expect(rewriteAgentHandles(text)).toBe(
      `subagent_type: "${AGENT_DIR_PREFIX}orchestrate-database" and \`${AGENT_DIR_PREFIX}orchestrate-api\``,
    )
  })

  test("leaves slash commands and bare agent names alone", () => {
    const text = "Run /agent-orch:brainstorm, then pick orchestrate-database"
    expect(rewriteAgentHandles(text)).toBe(text)
  })
})

describe("unwrapLeanCtx", () => {
  test("unwraps a lean-ctx -c wrapper, restoring escaped single quotes", () => {
    const wrapped = `/opt/homebrew/bin/lean-ctx -c 'git commit -m '\\''feat: x'\\'''`
    expect(unwrapLeanCtx(wrapped)).toBe("git commit -m 'feat: x'")
  })

  test("returns unwrapped commands unchanged", () => {
    expect(unwrapLeanCtx("git status")).toBe("git status")
  })
})

describe("extractPatchPaths", () => {
  test("collects add, update, delete, and move-target paths", () => {
    const patch = [
      "*** Begin Patch",
      "*** Add File: src/new.ts",
      "+x",
      "*** Update File: src/old.ts",
      "*** Move to: src/renamed.ts",
      "@@",
      "*** Delete File: src/gone.ts",
      "*** End Patch",
    ].join("\n")
    expect(extractPatchPaths(patch)).toEqual(["src/new.ts", "src/old.ts", "src/renamed.ts", "src/gone.ts"])
  })
})

describe("toHookPayloads", () => {
  test("maps the V2 shell tool to Bash and unwraps lean-ctx", () => {
    const payloads = toHookPayloads("shell", { command: `lean-ctx -c 'git commit -m x'` })
    expect(payloads).toEqual([{ tool_name: "Bash", tool_input: { command: "git commit -m x" } }])
  })

  test("maps edit/write `path` to the Claude-style `file_path`", () => {
    expect(toHookPayloads("edit", { path: "/a.ts", oldString: "x" })).toEqual([
      { tool_name: "Edit", tool_input: { path: "/a.ts", oldString: "x", file_path: "/a.ts" } },
    ])
    expect(toHookPayloads("write", { path: "/b.ts", content: "" })[0]?.tool_name).toBe("Write")
  })

  test("expands a patch into one Edit payload per touched file", () => {
    const patchText = "*** Begin Patch\n*** Update File: a.ts\n*** Add File: b.ts\n*** End Patch"
    expect(toHookPayloads("patch", { patchText })).toEqual([
      { tool_name: "Edit", tool_input: { file_path: "a.ts" } },
      { tool_name: "Edit", tool_input: { file_path: "b.ts" } },
    ])
  })

  test("ignores tools the guards do not cover", () => {
    expect(toHookPayloads("read", { path: "/a.ts" })).toEqual([])
    expect(toHookPayloads("shell", null)).toEqual([])
  })
})

describe("resolveModels", () => {
  test("defaults the Claude aliases to the SSC provider models", () => {
    const models = resolveModels(undefined)
    expect(models.opus).toBe("SSC/us.anthropic.claude-opus-5-5")
    expect(models.sonnet).toBe("SSC/us.anthropic.claude-sonnet-5-5")
    expect(models.haiku).toBe("SSC/us.anthropic.claude-haiku-4-5-20251001-v1:0")
  })

  test("honors qualified aliases from an agent-orch models config, ignoring bare ones", () => {
    const models = resolveModels({ aliases: { opus: "anthropic/claude-opus-4", sonnet: "sonnet" } })
    expect(models.opus).toBe("anthropic/claude-opus-4")
    expect(models.sonnet).toBe("SSC/us.anthropic.claude-sonnet-5-5")
  })
})

describe("renderAgent", () => {
  const source = [
    "---",
    "name: orchestrate-database",
    "description: Database Architect specialist.",
    "tools: Glob, Grep, Read, Bash, Task",
    "model: sonnet",
    "---",
    "",
    "Delegate to agent-orch:orchestrate-validator when done.",
    "",
  ].join("\n")

  test("emits V2 frontmatter: subagent mode, resolved model, no Claude tools list", () => {
    const out = renderAgent(source, resolveModels(undefined))
    const { data, body } = parseFrontmatter(out)
    expect(data.mode).toBe("subagent")
    expect(data.model).toBe("SSC/us.anthropic.claude-sonnet-5-5")
    expect(data.description).toBe("Database Architect specialist.")
    expect(data.tools).toBeUndefined()
    expect(body).toContain(`${AGENT_DIR_PREFIX}orchestrate-validator`)
  })

  test("omits the model line for an unknown alias so the agent inherits", () => {
    const out = renderAgent(source.replace("model: sonnet", "model: mystery"), resolveModels(undefined))
    expect(parseFrontmatter(out).data.model).toBeUndefined()
  })
})

describe("buildTrailer", () => {
  // Mirrors TRAILER_REGEX in plugins/agent-orch/hooks/validate-ai-commit.sh.
  const validatorAccepts = (trailer: string, ghUser: string) => {
    const esc = ghUser.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    return new RegExp(
      `Co-authored-by:\\s+${esc}\\s\\+\\s(claude-code|opencode|pi)/\\S+\\s<${esc}@users\\.noreply\\.github\\.com>`,
      "i",
    ).test(trailer)
  }

  test("produces a trailer the commit validator accepts, even for a name with a comma and space", () => {
    const trailer = buildTrailer("Pham, Tung", resolveModels(undefined))
    expect(validatorAccepts(trailer, "Pham, Tung")).toBe(true)
  })
})

describe("summarizeDescription", () => {
  test("keeps short descriptions and trims long ones at a sentence boundary", () => {
    expect(summarizeDescription("Short.")).toBe("Short.")
    const long = `${"A".repeat(80)}. ${"B".repeat(200)}`
    expect(summarizeDescription(long)).toBe(`${"A".repeat(80)}.`)
  })
})

describe("commandTemplate", () => {
  test("tells the model to load the skill and forwards the arguments", () => {
    const text = commandTemplate("agent-orch", "brainstorm", "JIRA-1")
    expect(text).toContain("`brainstorm`")
    expect(text).toContain("skill")
    expect(text).toContain("JIRA-1")
  })
})

describe("buildPreamble", () => {
  test("is marked, uses V2 tool names, and states the commit trailer", () => {
    const text = buildPreamble({ trailer: "Co-authored-by: me", models: resolveModels(undefined) })
    expect(text).toContain(PREAMBLE_MARKER)
    expect(text).toContain("shell")
    expect(text).toContain("subagent")
    expect(text).toContain("Co-authored-by: me")
    expect(text).not.toContain("todowrite")
    expect(text).not.toContain('subagent_type: "general"')
  })
})

describe("discoverSkills", () => {
  let root: string

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "agent-orch-v2-"))
    const mk = (rel: string, contents: string) => {
      const full = join(root, rel)
      mkdirSync(join(full, ".."), { recursive: true })
      writeFileSync(full, contents)
    }
    mk("plugins/agent-orch/skills/build/SKILL.md", `---\nname: build\ndescription: Build it\n---\nUse agent-orch:orchestrate-builder\n`)
    mk("plugins/scout/skills/init/SKILL.md", `---\nname: init\n---\nScout body\n`)
    mk("plugins/scout/skills/nameless/SKILL.md", `---\ndescription: no name\n---\nx\n`)
    mkdirSync(join(root, "plugins/scout/skills/empty-dir"), { recursive: true })
  })

  afterAll(() => rmSync(root, { recursive: true, force: true }))

  test("finds named skills across sub-plugins, strips frontmatter, rewrites handles", () => {
    const { skills, skipped } = discoverSkills(root, ["agent-orch", "scout", "missing-plugin"])
    expect(skills.map((s) => `${s.plugin}:${s.id}`).sort()).toEqual(["agent-orch:build", "scout:init"])
    const build = skills.find((s) => s.id === "build")!
    expect(build.description).toBe("Build it")
    expect(build.content).toBe(`Use ${AGENT_DIR_PREFIX}orchestrate-builder\n`)
    expect(build.path).toBe(join(root, "plugins/agent-orch/skills/build/SKILL.md"))
    expect(skipped).toEqual([join(root, "plugins/scout/skills/nameless/SKILL.md")])
  })
})

describe("runHookScript", () => {
  let dir: string
  const script = (name: string, body: string) => {
    const p = join(dir, name)
    writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`)
    chmodSync(p, 0o755)
    return p
  }

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "agent-orch-v2-hooks-"))
  })

  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  test("exit 0 allows, and the payload arrives on stdin", async () => {
    const p = script("ok.sh", `grep -q '"cwd":"/x"' && exit 0 || exit 1`)
    expect(await runHookScript(p, { cwd: "/x" })).toEqual({ outcome: "allow" })
  })

  test("exit 2 blocks with the script's feedback", async () => {
    const p = script("block.sh", `echo "missing trailer" >&2; exit 2`)
    expect(await runHookScript(p, {})).toEqual({ outcome: "block", message: "missing trailer" })
  })

  test("any other exit is a script failure, not a block (fail open)", async () => {
    const p = script("crash.sh", `echo boom >&2; exit 1`)
    const result = await runHookScript(p, {})
    expect(result.outcome).toBe("error")
  })

  test("a timeout is a script failure, not a block", async () => {
    const p = script("slow.sh", `sleep 5`)
    const result = await runHookScript(p, {}, 200)
    expect(result.outcome).toBe("error")
  })
})
