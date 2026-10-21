---
description: Start a Ralph loop (opencode) in a Herdr pane, monitored via the Herdr integration
agent: build
---

# Ralph Loop

Start an Open Ralph Wiggum loop with the `ralph` CLI for this task, in a Herdr
pane, then return immediately:

$ARGUMENTS

## Arguments

Split `$ARGUMENTS` into task text and optional flags:

- `--max-iterations N` - passed to ralph. Optional; default 10 when omitted. Never start unbounded.
- `--model NAME` - pass through to ralph as `--model`
- `--tasks` - enable ralph task mode (state in `.ralph/ralph-tasks.md`)
- `--prompt-file PATH` - use PATH as the task prompt instead of inline text

Everything else is the task text. The completion promise is fixed:
`<promise>COMPLETE</promise>`.

## Flow

1. **Guards.** Stop with a clear message if any fails:
   - `test "${HERDR_ENV:-}" = 1` - this command only runs inside Herdr.
   - `command -v ralph && command -v herdr`.
   - The task has a verifiable success criterion (tests, typecheck, lint). Ask for one if missing.
2. **Prompt.** If the task text lacks a completion promise, append:
   `Output <promise>COMPLETE</promise> when all criteria pass.`
   Write the final prompt to `/private/tmp/ralph/<repo-slug>-<epoch>.md`. Never inline
   the prompt on the command line: `pane run` rejects long lines on macOS and quoting
   breaks. Keep this file - ralph reads it at launch; the pane transcript does not
   preserve the full task after the first screen.
3. **Worktree gate.** Run `git rev-parse --git-dir --git-common-dir` when the two differ
   the cwd is a linked worktree (pass). In the main checkout: clean tree AND branch is
   not the default branch passes; otherwise offer the `git-worktree-setup` skill, then
   stop. Ralph auto-commits per iteration; do not start on dirty user work.
4. **Permissions.** Ralph hands `--allow-all` to itself, but the
   child `opencode run` still auto-rejects anything blocked by project/global config.
   Grep `opencode.json` (project then `~/.config/opencode/opencode.json`) for the tools
   the task will need (edit, write, shell). If a needed tool lacks an `"allow"`
   permission, warn and stop; the loop burns iterations on auto-rejections.
5. **Launch.**
   - `herdr pane layout --pane "$HERDR_PANE_ID"` - split right if width > 100, else down.
   - `herdr pane split --current --direction <d> --cwd "$PWD" --no-focus`
   - from `.result.pane.pane_id`, derive the loop cwd `$LOOPDIR` (= split `--cwd`).
   - `herdr pane rename <id> ralph-<repo-slug>`.
   - `herdr pane run <id> "cd $LOOPDIR && ralph -f $PROMPT --max-iterations N [--model M] [--tasks]"`
   - Do NOT pass `--no-plugins`: it disables the Herdr state plugin and stops agent-state reporting.
6. **Confirm start.** `herdr pane wait-output <id> --match "Starting loop" --timeout 60000`.
   Then find the agent in `herdr agent list` (pane id = `<id>`); expect kind
   `opencode`, state `working`. If not detected, record that in the summary and rely
   on pane reads below.
7. **Report and return.** Print a short summary:
   - pane id, agent name/state, loop cwd, max iterations, prompt-file path.
   - Monitor commands:
     `herdr agent get <id>` (state: working / idle / blocked),
     `herdr pane read <id> --source recent-unwrapped --lines 80`,
     `herdr pane wait-output <id> --match "Task completed"`,
     and, from `$LOOPDIR` (state lives in `.ralph/` there): `ralph --status`,
     `ralph --add-context "<hint>"`, `ralph --clear-context`.
   - Then stop. Do not poll or wait for the loop to finish.

## Loop end states (for later reference)

- success: `Task completed in N iteration(s)`
- cap: `Max iterations (N) reached. Loop stopped.`
- abort: `Loop aborted after N iteration(s)`

## Safety

- Never start without a max iteration count; default 10.
- `--allow-all` (ralph default) auto-approves all tool permissions; the permission
  check in step 4 is the wall. Confirm the user accepts `--allow-all` before starting.
- Do not start in a directory with uncommitted user work unless the user confirms.
- Never close the loop pane unless the user asks.
- If the loop struggles, inject a hint: `ralph --add-context "<hint>"` from `$LOOPDIR`.
