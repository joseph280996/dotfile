# Design: Consolidate Agent Config into a Single Canonical Store

**Date:** 2026-10-07 (rev 2, after review)
**Status:** Revised after review; pending user approval
**Repos touched:** `~/config` (dotfiles); user home directories

## Context

OpenCode is the user's only harness (Claude Code CLI retired; Claude Desktop installed
but never used). Agent config is fragmented across these locations:

| Location | Contents (verified 2026-10-07) | Disposition |
|---|---|---|
| `~/.config/opencode/` (= `~/config/.config/opencode`) | 101 skills, 33 agents, 82 commands, rules, plugins, tools, `opencode.json` | **Canonical** — tracked by `!.config/opencode/**` in `~/config/.gitignore` |
| `~/.claude/` | 23 skills, 6 agents, 1 command, 9 rule dirs, hooks, plugin marketplaces, `CLAUDE.md`, `settings.json` (plaintext `ANTHROPIC_AUTH_TOKEN`) | Retire → archive |
| `~/.claude.json` | Claude Code global state (67 KB) | Retire → archive |
| `~/.claude-mem/` | claude-mem plugin DB/state (no worker process running) | Retire → archive |
| `~/.agents/` | 26 skills + `.skill-lock.json` (skills-installer manifest) | Merge → `skills/` becomes symlink to canonical |
| `~/.cagent/` | Docker `cagent` store, 28 blobs, untouched since March | Zombie → move to archive |
| `~/.lean-ctx/` | **Live** lean-ctx dir; `tee/` holds captured command output (may contain secrets) | Keep dir; purge `tee/` |
| `~/.config/fish/conf.d/environment.fish` | Plaintext `SSC_AI_GATEWAY_KEY` (line 36); not git-tracked | Key → Keychain |
| `~/.plannotator/`, `~/.copilot/`, `~/.local/share/opencode/`, `~/.cache/opencode/` | App-owned data | Out of scope |
| `~/Library/Application Support/Claude/` | Claude Desktop (never used) | Out of scope; see note below |
| `~/Code/Personal/ECC/skills/` | 293 skills; rsync source for vendored skills | Sync guard (§6) |
| `~/.agent/` | Does not exist; referenced by `opencode.json` `global-skills` | Fix reference |

OpenCode V2 discovers skills in `~/.config/opencode/skills`, plus compatibility sources
`~/.claude/skills` and `~/.agents/skills`. Precedence, from lowest to highest: built-ins →
`.claude` → `.agents` → `~/.config/opencode` → project → explicit `skills` config.
Skill IDs are path-derived.

**Claude Desktop note:** Desktop bundles its own Claude Code (v2.1.229) that would use
`~/.claude`. Because Desktop is unused, archiving `~/.claude` is acceptable. If Desktop's
Code mode is ever launched, it recreates `~/.claude`, and OpenCode starts scanning
`~/.claude/skills` again. Verification checks that the directory is absent.

## Goals

1. One canonical, git-tracked store for skills, agents, commands, and rules: `~/.config/opencode/`.
2. Retire Claude Code by archiving it. Nothing is destroyed; everything can be restored.
3. Other runtimes can still find canonical skills through a `~/.agents/skills` symlink.
4. Move zombie directories into the archive and fix stale config references.
5. Remove plaintext secrets from config files and rotate the keys exposed during this work.
6. ECC rsync must never overwrite locally maintained skills.

## Non-goals

- No changes to skill content. OpenCode alignment (tool renames, path mapping,
  annotations) is **phase 2**, run against the consolidated store afterwards.
- No changes to Plannotator, Copilot, Claude Desktop, or OpenCode runtime data.

## Settled decisions (user-approved)

1. Canonical home: `~/.config/opencode/`.
2. Claude Code: retired. Archive `~/.claude/`, `~/.claude.json`, and `~/.claude-mem/` in full.
3. Cleanup scope: full cleanup, including the secret fixes.

## Archive

`~/.local/share/retired/claude-code-<execution date, YYYY-MM-DD>/`, mode 700, outside
every git repo. It contains secrets and session data and must never be committed. It holds:

- Moved directories: `~/.claude/`, `~/.claude.json`, `~/.claude-mem/`, `~/.cagent/`.
- **Full copies** of everything replaced or overridden: the original `~/.agents/skills/`
  tree, every copy that lost a divergence resolution, the loose `grilling` copy, the
  4 colliding Claude agents, and the pre-edit `environment.fish`.
- `MANIFEST.txt` (paths, sizes, mtimes captured in pre-flight), `MIGRATION-REPORT.md`
  (every merge decision and unified diff), and `restore.sh` (supports `--dry-run`).

## Target state

```
~/.config/opencode/
├── skills/   # 117 = 101 canonical + 15 from ~/.agents + lean-ctx from ~/.claude
├── agents/   # 33 existing + exploratory-testing, fullstack-code-reviewer (converted)
├── commands/ # 82 existing + address-all-issues.md (reviewed)
├── rules/    # existing top-level *.md; ~/.claude/rules/* copied to rules/claude-legacy/
└── docs/specs/  # this spec

~/.agents/skills → ~/.config/opencode/skills   (symlink; .skill-lock.json stays)
~/.claude, ~/.claude.json, ~/.claude-mem, ~/.cagent   (moved into the archive)
```

## 5. Merge rules

**Skills.** 16 are merged (15 from `~/.agents`, plus `lean-ctx` from `~/.claude`): `grill-me`, `grill-with-docs`, `handoff`,
`teach`, `to-questionnaire`, `plannotator`, `plannotator-annotate`, `plannotator-last`,
`plannotator-review`, `research`, `writing-for-agents`, `find-docs`, `codebase-design`,
`domain-modeling`, `git-worktree-setup`, and `lean-ctx`. This was checked against
every `SKILL.md` in the plugin caches: no candidate collides with a plugin-provided skill.
`git-worktree-setup` was added on 2026-10-12: the original §5 list missed it, and it is
referenced by `AGENTS.md`.

- **Identical copies:** keep the canonical copy and log the drop.
- **Divergent copies:**
  - If the skill already exists in canonical, the canonical copy wins
    (`eclipse-splunk-investigation`, `resiliency-review`, `splunk-query`,
    `slack-markdown-formatter`).
  - If it doesn't (the `plannotator-*` trio, which differs between `.claude` and
    `.agents`), the `~/.agents` copy wins. `~/.agents` is the store still maintained;
    `~/.claude` is being retired.
  - Every losing copy is archived, and its unified diff goes into `MIGRATION-REPORT.md`
    so the user can override any decision.
  - mtime is **not** used to decide: `rsync -a` keeps the source's timestamps, so
    mtimes say nothing about which copy is newer.
- **`grilling` exception:** the superpowers plugin ships an active `grilling` skill whose
  body differs from the loose copy. Canonical has higher precedence than plugin skills,
  so merging the loose copy would silently override the plugin's. Archive it; don't merge.
- **The five delisted IDs** (`grill-me`, `grill-with-docs`, `handoff`, `teach`,
  `to-questionnaire`) all set `disable-model-invocation: true`. V2 hides such skills from
  the model's list wherever they live, and `opencode.json` has no skill permission
  rules, so the cause of the delisting is unknown. They are merged as **user-invoked
  skills (`@id`)**. This design does not claim to restore model visibility.

**Agents** (V2 Markdown agent format; `tools`, `permission`, and `prompt` are legacy):

- `build-error-resolver`, `code-reviewer`, `e2e-runner`, `frontend-code-reviewer` already
  exist in canonical. The canonical copies win (they are hand-maintained and carry the
  Prompt Defense Baseline header). The Claude copies are archived.
- `exploratory-testing` and `fullstack-code-reviewer` are converted:
  - `desc`/`description` → `description`; add `mode: subagent`.
  - Drop `model: opus` so the agent inherits the session's model (Claude aliases aren't
    V2 model IDs).
  - Map `tools: [...]` to a `permissions` list: if Write/Edit/MultiEdit are absent, add
    `{action: edit, resource: "*", effect: deny}`; if Bash is absent, add
    `{action: shell, resource: "*", effect: deny}`.
  - The body stays as the system prompt.
  - Each conversion is shown in the report.

**Commands:** `address-all-issues.md` is copied after a check that its template uses only
`$ARGUMENTS`-style substitution.

**Rules:** `~/.claude/rules/*` is copied to `rules/claude-legacy/`. It loads nowhere,
because the `instructions` glob `~/.config/opencode/rules/*.md` matches only top-level
files. The user can wire individual rules in later.

## 6. Sync guard

`scripts/symlink-skills.sh` runs `rsync --delete` per skill from ECC into canonical. It
already skips names ECC doesn't have, so today nothing is at risk. The guard protects
against **future** name collisions: a hardcoded `LOCAL_ONLY` array, checked before each
rsync, lists the 12 hand-maintained skills (`code-review`, `eclipse-splunk-investigation`,
`find-skills`, `git-commit`, `git-worktree-setup`, `resiliency-review`, `resiliency-review-walkthrough`,
`review-pr`, `slack-markdown-formatter`, `splunk-query`, `unit-test-fixer`,
`vercel-react-best-practices`) plus the 16 merged in §5. Each match is skipped with a log
line.

**Second writer:** once `~/.agents/skills` is a symlink, the skills installer
(`.skill-lock.json`) writes updates straight into canonical. This is accepted, because
those updates show up as reviewable git diffs. Phase 2's alignment codemod must be re-run
after any `npx skills update`; this rule is recorded in the phase-2 spec.

## 7. Secrets

Both keys were exposed in this design session's tool output (sent to the model provider
and captured by the lean-ctx tee logs):

| Secret | Location | Action |
|---|---|---|
| `ANTHROPIC_AUTH_TOKEN` | `~/.claude/settings.json` | Used only by the retired Claude Code. User **rotates/revokes** it at the gateway; it is archived with `~/.claude`. No Keychain entry. |
| `SSC_AI_GATEWAY_KEY` | `environment.fish:36`, plaintext | User **rotates** it. The new value goes into Keychain through an interactive prompt (`security add-generic-password -s ssc-ai-gateway -a tpham4 -w`, typed by the user, never pasted into chat). Line 36 becomes `set -gx SSC_AI_GATEWAY_KEY (security find-generic-password -s ssc-ai-gateway -a tpham4 -w)`. |

- **Pre-flight:** find every consumer of `SSC_AI_GATEWAY_KEY` (plugins, OpenCode
  config/auth) before editing anything.
- `environment.fish` stays out of git.
- The OpenCode background service inherits its environment when it starts, so
  verification restarts the service from a fresh shell.
- Purge `~/.lean-ctx/tee/` of all logs captured before the migration.

## 8. Sequencing

0. **Pre-flight** (read-only):
   - Write manifests.
   - Scan for `.claude` references across live config, `scripts/`, and the npm plugin
     caches. Known hits go to phase 2: `setup-package-manager.js` and `tdd-workflow`
     (`~/.claude/package-manager.json`), and `harness-audit.js` (`~/.claude/plugins`).
   - Find every `SSC_AI_GATEWAY_KEY` consumer.
   - Confirm no claude-mem worker is running.
   - Check git status of the touched paths. Commits stage explicit paths only, because
     `~/config` has unrelated uncommitted work.
1. Create the archive (mode 700) and make full copies of everything listed under Archive.
2. Merge skills, agents, commands, and rules into canonical → **commit 1**.
3. Add the `LOCAL_ONLY` guard to `symlink-skills.sh` → **commit 2**.
4. Change the `opencode.json` `global-skills` path to `~/.config/opencode/skills` → **commit 3**.
5. Move `~/.claude`, `~/.claude.json`, `~/.claude-mem`, and `~/.cagent` into the archive.
   Replace `~/.agents/skills` with the symlink. Purge the tee logs. Write
   `MIGRATION-REPORT.md` and `restore.sh`.
6. Secrets: the user rotates both keys, then the Keychain entry is created and
   `environment.fish` edited (not committed).
7. Verification (§9).
8. Phase 2: the alignment codemod, with its own spec.

## 9. Verification

- `~/.claude`, `~/.claude.json`, `~/.claude-mem`, and `~/.cagent` are absent;
  `~/.agents/skills` resolves to canonical; `ls` shows 117 skills.
- From a fresh fish shell: `opencode service restart`, then a model request through the
  SSC provider succeeds. This proves the Keychain path works.
- The agent loads one merged, non-delisted skill (`research`) through the `skill` tool.
  The **user** runs `@handoff` to check one delisted skill (the agent must not use those IDs).
- `exploratory-testing` and `fullstack-code-reviewer` appear in the subagent catalog.
- A `.claude` grep of live config returns only the known phase-2 hits.
- A secret probe of `git log -p` over the 3 new commits finds no
  `ANTHROPIC_AUTH_TOKEN`/`SSC_AI_GATEWAY_KEY` with a value.
- `restore.sh --dry-run` lists every path it would restore.

## 10. Rollback

- `restore.sh` moves the archived directories back, removes the `~/.agents/skills`
  symlink, restores the full copy of that tree, and restores `environment.fish`.
- `git revert` commits 1–3 in `~/config`.
- Rotated keys are not rolled back.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| A secret is committed | Archive lives outside repos; `environment.fish` untracked; secret probe on new commits |
| ECC sync overwrites local skills | `LOCAL_ONLY` guard |
| The installer overwrites phase-2 edits | Re-run the codemod after installer updates (phase-2 rule); updates show as git diffs |
| A merge resolution loses content | Canonical-wins default, full losing copies archived, diffs in report |
| A plugin skill is silently overridden | Merge candidates checked against plugin caches; `grilling` excluded |
| Keychain lookup fails in the service environment | Restart the service from a fresh shell and make a provider request during verification |
| Desktop recreates `~/.claude` | Verification checks it's absent; out of scope beyond that |

## Open questions

None.
