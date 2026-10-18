#!/usr/bin/env bun
/**
 * Renders the 28 V1 Claude Code agents in the agent-orch clone
 * (`plugins/agent-orch/agents/*.md`) as V2 agent files under
 * `~/.config/opencode/agents/agent-orch/`.
 *
 * V2 plugins cannot register agents programmatically — only files under
 * `agents/**\/*.md` are picked up, with the nested path becoming the agent
 * ID (`agents/agent-orch/orchestrate-database.md` -> `agent-orch/orchestrate-database`).
 * This script is the agent half of what plugins/agent-orch-v2.ts does for
 * skills and commands at runtime.
 *
 * Usage: `bun scripts/generate-agent-orch-agents.ts`
 * Re-run whenever the clone updates. Do not hand-edit the generated files.
 */

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { readModelsConfig, renderAgent, resolveModels } from "../plugins/lib/agent-orch-v2.ts"

const ROOT = process.env.AGENT_ORCH_ROOT ?? join(homedir(), ".config", "opencode", "claude-agent-orchestration-plugin")
const SOURCE_DIR = join(ROOT, "plugins", "agent-orch", "agents")
const OUTPUT_DIR = join(homedir(), ".config", "opencode", "agents", "agent-orch")

function main(): void {
  let entries: string[]
  try {
    entries = readdirSync(SOURCE_DIR).filter((f) => f.endsWith(".md"))
  } catch (err) {
    console.error(`Cannot read ${SOURCE_DIR}: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }

  if (entries.length === 0) {
    console.error(`No agent .md files found under ${SOURCE_DIR}`)
    process.exit(1)
  }

  mkdirSync(OUTPUT_DIR, { recursive: true })

  // Clean only the .md files we generate, so an upstream agent that
  // disappears also disappears here, without touching anything else a user
  // might have placed in this directory.
  for (const existing of readdirSync(OUTPUT_DIR)) {
    if (existing.endsWith(".md")) rmSync(join(OUTPUT_DIR, existing))
  }

  const models = resolveModels(readModelsConfig(process.cwd()))

  console.log(`Rendering ${entries.length} agent(s) from ${SOURCE_DIR} -> ${OUTPUT_DIR}`)
  for (const file of entries.sort()) {
    const source = readFileSync(join(SOURCE_DIR, file), "utf8")
    const rendered = renderAgent(source, models)
    writeFileSync(join(OUTPUT_DIR, file), rendered)

    const modelLine = /^model: (.+)$/m.exec(rendered)
    console.log(`  ${file} -> model: ${modelLine ? modelLine[1] : "(inherited)"}`)
  }

  console.log(`Done: ${entries.length} agent(s) written.`)
}

main()
