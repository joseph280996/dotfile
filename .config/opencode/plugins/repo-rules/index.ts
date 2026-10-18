import { Plugin } from "@opencode/plugin"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"

const KB = process.env.HOME + "/Documents/knowledge-base"
const CAP = 4096

// Cache keyed by file path; invalidated by mtime. The hook fires per
// model call, so every read must be cheap after the first.
const cache = new Map<string, { mtime: number; text: string }>()

async function readCached(file: string): Promise<string | undefined> {
  const m = await stat(file).then((s) => s.mtimeMs, () => undefined)
  if (m === undefined) return undefined
  const hit = cache.get(file)
  if (hit && hit.mtime === m) return hit.text
  const text = await readFile(file, "utf8").catch(() => undefined)
  if (text === undefined) return undefined
  cache.set(file, { mtime: m, text })
  return text
}

async function folderFor(canonical: string): Promise<string | undefined> {
  const repo = path.basename(canonical)
  const raw = await readCached(`${KB}/repo-map.json`)
  if (!raw) return undefined
  let map: Record<string, string> | undefined
  try {
    map = (JSON.parse(raw) as { map?: Record<string, string> }).map
  } catch {
    return undefined
  }
  const mapped = map?.[repo]
  const fallback = `Eclipse/Trading/${repo}`
  const exists = await stat(`${KB}/${fallback}`).then(() => true, () => false)
  return mapped ?? (exists ? fallback : undefined)
}

async function projectCanonical(location: unknown): Promise<string | undefined> {
  const canonical = (location as { project?: { canonical?: string } })?.project?.canonical
  return typeof canonical === "string" && canonical.length > 0 ? canonical : undefined
}

export default Plugin.define({
  id: "tpham.repo-rules",
  async setup(ctx) {
    await ctx.session.hook("context", async (event) => {
      try {
        const canonical = await projectCanonical(ctx.location)
        if (!canonical) return
        const folder = await folderFor(canonical)
        if (!folder) return
        const rules = await readCached(`${KB}/${folder}/rules.md`)
        if (!rules) return
        const body = rules.length > CAP ? rules.slice(0, CAP) + "\n<!-- truncated: split rules.md -->" : rules
        const repo = path.basename(canonical)
        event.system.push({
          type: "text",
          text: `<repo-rules repo="${repo}" source="${folder}">\n${body}\n</repo-rules>`,
        })
      } catch {
        // Fail silent — never break a session.
      }
    })
  },
})
