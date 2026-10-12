---
name: git-worktree-setup
description: Create a new git worktree seeded with the personal local-dev setup changes (dev route naming, local config edits) that are never committed, then run project setup. Trigger when the user asks to create a new worktree, make a worktree, or create a worktree for a branch.
---

# Git worktree setup

Creates a worktree and seeds it with the local-only setup changes living
uncommitted in the main worktree (the first entry in `git worktree list`), then
runs the project's setup. The script is `scripts/new-worktree.sh` next to this
file; run it from inside the repository.

## Workflow

1. **Gather what is missing.** Ask for the branch name if not given, and
   **always ask** which base to use: the current branch or the default branch.
   Never guess the base.
2. **Branch exists?** If the branch already exists, ask whether to reuse it
   (`--existing reuse`) or stop. A branch checked out in another worktree
   cannot be reused.
3. **Preview and confirm.** Run `create --dry-run` and show the user the list
   of setup changes. **Wait for their OK before creating.** This is where
   stray work-in-progress in the main worktree gets caught.
4. **Create.** Run `create --branch <name> --base current|default`.
5. **Handle the exit code:**
   - `2` — the patch had conflicts. List the conflicting files and help
     resolve them by editing the files; the markers stay in the working tree.
   - `3` — the Node install failed. The Node version from `.nvmrc` is likely
     outdated for the lockfile. Work out a compatible version from:
     `engines.node` in `package.json`, `lockfileVersion` in
     `package-lock.json` (v2/v3 need npm >= 7), the error text (`EBADENGINE`,
     unsupported engine), and the latest LTS (`nvm ls-remote --lts`). Then
     re-run `setup <worktree> --node-version <v>`. Do not modify `.nvmrc`;
     report the version used instead.
   - `4` — branch exists; go back to step 2.
6. **Extra setup.** Read `README*` / `CONTRIBUTING*` for setup steps beyond
   what ran automatically (make targets, codegen, docker-compose, env files).
   Propose them and **run only after the user confirms**.
7. **Report.** Give the user the worktree path and remind them the copied
   setup files are local-only and must not be committed.

## What the script copies

- Tracked changes vs HEAD in the main worktree — modified, staged, deleted,
  renamed — applied with `git apply --3way` and left unstaged; conflicts
  survive as markers in the files.
- Untracked, non-ignored files, copied in one tar pipe.
- Gitignored files are never copied.

## What setup runs automatically

Detected per ecosystem, all matches run (monorepos included):

| Detector | Command |
|---|---|
| `*.sln` or `*.csproj` | `dotnet restore` |
| `go.mod` | `go mod download` |
| `package.json` | `.nvmrc` -> `nvm install` + `nvm use`, then lockfile picks the manager: `pnpm-lock.yaml` -> `pnpm install`, `yarn.lock` -> `yarn install`, else `npm install` |

Exit codes: `0` ok, `2` patch conflicts, `3` node install failed, `4` branch
exists with `--existing fail`. Any other nonzero exit is a fatal error (not a
git repo, bad args) or a failed setup step — the script output names it.
