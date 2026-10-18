---
name: orchestrating-parallel-workers
description: Use when fanning out multi-step work to parallel workers — spawning subagent or herdr workers, writing task files, or when a worker stalls, gets blocked, or its report is needed
---

# Orchestrating parallel workers

You are the orchestrator. Workers execute one task each; you keep the loop,
the context, and the decisions. Read this page fully before the first
dispatch; it exists to prevent five known failure modes:
permission stalls, stale-spec drift, scrollback-lost reports,
hook-blocked prompts, and faithful copying of task-file bugs.

## Channels: subagent first, herdr when it outlives a subagent

- **Default: background `subagent` calls with `agent: "worker"`.** One
  subagent per task, dispatched together. Permission requests and results
  stay in your session; nothing waits in an unwatched pane.
- **Use herdr panes instead** only when a task needs a long-lived process
  (dev server, interactive session) or the user asked to watch it live.
  Herdr rules apply: one agent per pane, `--no-focus`, explicit `--cwd`.
- **Cap: 4 concurrent workers.** If more tasks exist, run in waves.

## Task-file protocol

1. In `/private/tmp/tasks/`, write one file per task:
   `<task-id>.md`, numbered from `01`.
2. Each file carries a `version:` line at the top and these sections:
   `## Goal`, `## Steps`, `## Out of bounds`, `## Verification`,
   `## Report path`.
3. **Independence check before writing**: two tasks are parallel-safe only
   if neither reads nor writes a file the other touches. Sequential
   dependencies go in one task, in order.
4. Task files live in `/private/tmp/tasks/` — never in a worktree or repo,
   so no governance hook or git status ever sees them.
5. Keep task IDs stable; workers name their reports after them.

## Pre-flight: advisor reviews the task files

Before any dispatch, give the `advisor` the set of task files plus the
one-line goal of the fan-out. This is the cheapest place to catch a bug
that five workers would otherwise copy faithfully. Fix the files, bump
every `version:` line, re-review if the changes are more than cosmetics.

## Dispatch

- Prompt per worker is **one line**: `Read /private/tmp/tasks/<task-id>.md
  and execute it. Your report path is in the file.` No task content goes
  inline — hooks and stale-copy risks live in prompt text. (The worker
  profile instructs `cat`-fallback when `read` is denied; it observed this
  in testing, so the prompt stays one line either way.)
- After dispatch, verify each worker produced a report file; a missing
  report after its work window is the fail-loud signal to investigate.

## Correcting a running worker

1. Edit the task file — never send corrections as prompt text.
2. Bump its `version:` line.
3. Background subagent: if it has not finished, note the pending
   correction and re-dispatch a fresh worker after it returns; a running
   subagent cannot re-read mid-flight. Herdr pane: send one line —
   `Your task file changed (version bumped). Re-read it and continue.`
   If drift is severe, wait for completion and respawn on the new version.

## Collecting and closing

1. Read every report **file** — never trust pane scrollback for content.
2. Ensure every `BLOCKED` line became a visible decision for the user.
3. Send the combined diff to the `code-reviewer` subagent before reporting
   completion.
4. Report results to the user with the report paths, per-task status, and
   the combined BLOCKED list.

## When to reconsider an orchestrator agent

Kill this skill's approach and escalate only when polling noise in this
session measurably degrades the task, or fan-outs regularly exceed five
workers. Then design a **primary-mode** orchestrator with `edit: deny`
outside task paths — never a subagent; it cannot reach the user when a
worker blocks.
