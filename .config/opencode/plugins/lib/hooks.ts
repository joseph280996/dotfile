/**
 * Shared hook gating for opencode plugins.
 *
 * Ported from ECC's `ecc-hooks.ts` gating primitives, scaled to this config.
 * See docs/superpowers/specs/2026-08-05-opencode-hook-gating-layer-design.md
 *
 * Two hard constraints from the opencode runtime shape this file:
 *
 * 1. This file MUST live under `plugins/lib/`, never directly in `plugins/`.
 *    opencode discovers plugins with `scan("{plugin,plugins}/*.{ts,js}")` — a
 *    single `*`, so non-recursive. A file directly in `plugins/` has EVERY one
 *    of its runtime exports checked with `typeof x === "function"`, and any
 *    non-function throws `TypeError: Plugin export is not a function`. That
 *    would break *both* real plugins, not just this one. Living in `lib/`
 *    is what makes the `const`/`type` exports below legal.
 *
 * 2. Every export here is NON-THROWING. `event` hooks are invoked un-awaited
 *    with no error path, so an async throw inside one becomes an unhandled
 *    rejection (see the comment in advisor.ts). Helpers return a safe default
 *    instead of throwing.
 *
 *    The *direction* of that default is per-helper, not uniform:
 *    - `hookEnabled` fails OPEN (returns `true`). A hook silently not running is
 *      harder to diagnose than one running when it shouldn't.
 *    - `requireBinary` fails CLOSED (returns `false`). There is no useful
 *      "assume it's there" for a binary you cannot execute.
 *    - `sentinelExists` fails CLOSED (returns `false`), i.e. an unreadable
 *      sentinel means "not disabled", matching `hookEnabled`'s posture.
 *
 * Deliberately free of third-party dependencies: no `@opencode-ai/plugin`
 * runtime import. Only `node:fs`, a builtin that always resolves. Nothing here
 * can fail to resolve, which is why a static import is safe (unlike ECC's
 * dynamic-import-in-try/catch, which exists because its lib is optional).
 */

import { existsSync } from "node:fs"

/**
 * Escalating verbosity tiers, mirroring ECC's `ECC_HOOK_PROFILE`.
 *
 * Currently PARSED BUT NOT ENFORCED — see `hookEnabled`. With only two hooks in
 * this config, `OPENCODE_DISABLED_HOOKS` already expresses everything a user
 * would want, and a three-tier axis would be dead config surface. The type and
 * the `required` parameter exist so graduated gating can be switched on later
 * without touching any call site.
 */
export type HookProfile = "minimal" | "standard" | "strict"

/** Ordered so `profileOrder[current] >= profileOrder[required]` is the gate. */
const PROFILE_ORDER: Record<HookProfile, number> = {
  minimal: 0,
  standard: 1,
  strict: 2,
}

function parseProfile(raw: string | undefined): HookProfile {
  if (raw === "minimal" || raw === "strict") return raw
  return "standard"
}

/**
 * Active profile, parsed once at module load.
 *
 * Bun caches module instances, so every plugin importing this file shares this
 * value — which is the intent. It also means env parsing must be side-effect
 * free and happen exactly once, as it does here.
 */
export const profile: HookProfile = parseProfile(process.env["OPENCODE_HOOK_PROFILE"])

/** Hook IDs from `OPENCODE_DISABLED_HOOKS`, parsed once at module load. */
const disabled: ReadonlySet<string> = new Set(
  (process.env["OPENCODE_DISABLED_HOOKS"] ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean),
)

/**
 * Whether a hook should run.
 *
 * Fails OPEN: anything unexpected yields `true`. A hook silently not running is
 * far harder to diagnose than one running when it shouldn't.
 *
 * @param id Colon-namespaced hook ID, e.g. `advisor:consult`.
 * @param required Reserved. Accepted and range-checked, but does NOT gate yet —
 *   see the `HookProfile` note above. Passing it now keeps call sites stable for
 *   when it does.
 */
export function hookEnabled(id: string, required?: HookProfile | HookProfile[]): boolean {
  try {
    if (disabled.has(id)) return false

    // Profile enforcement is deliberately inert. The argument is range-checked
    // so an unrecognised value is noticed here rather than silently treated as
    // a valid tier, but the result is not yet used to gate — an unknown profile
    // returns true, consistent with the fail-open policy above. Flip this to
    // `return profileAllowed(required)` to enable graduated profiles.
    if (required !== undefined) {
      const list = Array.isArray(required) ? required : [required]
      if (!list.every(isProfile)) return true
    }

    return true
  } catch {
    return true
  }
}

function isProfile(value: unknown): value is HookProfile {
  return value === "minimal" || value === "standard" || value === "strict"
}

/**
 * Whether the active profile is at least `required`.
 *
 * Unused by `hookEnabled` today (profiles are inert); exported so the semantics
 * are testable and reviewable before being switched on.
 */
export function profileAllowed(required: HookProfile | HookProfile[]): boolean {
  const list = Array.isArray(required) ? required : [required]
  return list.some((entry) => PROFILE_ORDER[profile] >= PROFILE_ORDER[entry])
}

export type LogLevel = "debug" | "info" | "warn" | "error"

/**
 * A logger tagged with the hook ID, so output is greppable per hook.
 *
 * Writes to console rather than the SDK's `client.app.log`, deliberately: this
 * module stays dependency-free, and console output survives a plugin that
 * failed before it could obtain a client.
 */
export function scopedLog(id: string): (level: LogLevel, message: string) => void {
  return (level, message) => {
    try {
      const line = `[${id}] ${message}`
      if (level === "error") console.error(line)
      else if (level === "warn") console.warn(line)
      else console.log(line)
    } catch {
      // Logging must never be the thing that breaks a hook.
    }
  }
}

/**
 * Minimal structural shape of the `$` shell helper from `PluginInput`.
 *
 * Deliberately not imported from `@opencode-ai/plugin` or `bun-types`: this
 * module stays free of third-party imports (see the header).
 *
 * Generic in the value type so Bun's real `$` — whose values are the narrower
 * `ShellExpression` — stays assignable. Parameter types are contravariant, so
 * hard-coding `unknown[]` here would reject the actual `$` we are handed.
 */
type Shell<V = string> = (strings: TemplateStringsArray, ...values: V[]) => {
  quiet: () => Promise<unknown>
}

/**
 * Whether an external binary is on PATH.
 *
 * Returns a boolean rather than short-circuiting the caller, so each plugin
 * decides its own degraded behavior — lean-ctx returns `{}` (no hooks
 * registered), but another plugin might want to register a subset.
 */
export async function requireBinary(name: string, $: Shell): Promise<boolean> {
  try {
    await $`which ${name}`.quiet()
    return true
  } catch {
    return false
  }
}

/**
 * Whether a sentinel file exists — the "user turned this off out-of-band" switch.
 *
 * Kept alongside `hookEnabled` because `advisor.ts` needs both: the env var is
 * for per-invocation control, while the sentinel is a persistent toggle flipped
 * by the `/advisor-toggle` command. Sentinels live under
 * `~/.local/share/opencode/`, NOT the config dir, which is a git repo where a
 * sentinel would surface as a dirty file on every status check.
 */
export function sentinelExists(path: string): boolean {
  try {
    return existsSync(path)
  } catch {
    return false
  }
}
