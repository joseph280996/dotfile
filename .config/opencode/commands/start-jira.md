---
description: Start work on a Jira ticket — analyze it, set up a worktree, grill out a plan, get Plannotator approval, then execute in parallel workers.
agent: plan
subtask: false
---

# Start Jira

Start and drive the whole of work on this Jira ticket: $ARGUMENTS

Run the two phases in order. Phase 2 starts only after Plannotator approval.

## Phase 1 — Plan

1. **Analyze the ticket.** Run the `/jira get` flow (the procedure in
   `commands/jira.md`): fetch the ticket via the `mcp-atlassian` MCP tools,
   extract summary, description, acceptance criteria, priority, labels,
   linked issues, and comments, and produce the structured analysis. Do
   this before any other work.

2. **Set up the worktree.** Run the `git-worktree-setup` skill. Suggest a
   branch name derived from the ticket: `trad/<last4>-<slug>` where
   `<last4>` is the last four digits of the issue number and `<slug>` is a
   short kebab-case topic from the summary. The skill still asks which base
   to use and confirms before creating — never guess the base.

3. **Grill.** Interview the user (one round at a time, questions numbered,
   each with your recommended answer) until the design tree for this ticket
   has no unsettled decisions. Facts are yours to find — never ask the user
   for anything you can look up in the repo or the ticket.

4. **Write the plan.** Save it to
   `~/notes/TRAD/Jiras/<last4>/plans/YYYY-MM-DD-<FULL-KEY>-<slug>.md`
   following `rules/jira-notes.md` (create folders; update an existing file
   for the same ticket/date/topic instead of duplicating; never commit in
   `~/notes`).

5. **Submit for review.** Call `submit_plan` with the plan. Plannotator is
   the only review gate — do not add any other agent review pass.

## Phase 2 — Execute (only after Plannotator approval)

If the review requests changes instead of approving, fix the plan and
resubmit from step 4.

1. **Invoke the `orchestrating-parallel-workers` skill** and follow it in
   full.

2. **Decompose the plan into parallel-safe tasks.** Run the skill's
   independence check: two tasks are parallel-safe only if neither reads
   nor writes a file the other touches; sequential dependencies go in one
   task, in order. This check is the estimate of how many tasks can run in
   parallel (cap 4 concurrent workers).

3. **Write the task files** in `/private/tmp/tasks/`, one per task,
   `<NN>.md` numbered from `01`, each with `version:` at the top and the
   sections the skill requires: `## Goal`, `## Steps`, `## Out of bounds`,
   `## Verification`, `## Report path`. Make `## Steps` a checkbox list.
   Task files are read-only to workers — a worker ticks its checklist copy
   inside its own report file, so each file has exactly one writer. Never
   put task files in a worktree or repo.

4. **Advisor pre-flight.** Give the `advisor` the task files plus the
   one-line goal of the fan-out. Fix the files, bump every `version:` line,
   and re-review if the changes are more than cosmetics.

5. **Dispatch.** Background `subagent` calls with `agent: "worker"`, one
   per task, dispatched together, prompt one line:
   `Read /private/tmp/tasks/<task-id>.md and execute it. Your report path is in the file.`
   Use a specialist agent instead of `worker` only when a task clearly
   matches one (for example `tdd-guide` for test-heavy tasks).

6. **Collect.** Read every report file — never trust scrollback for
   content. Verify each report exists; a missing report is the fail-loud
   signal. Every `BLOCKED:` line becomes a visible decision for the user.

7. **Review.** Send the combined diff to the `code-reviewer` subagent
   before reporting completion.

8. **Stop and report.** Print per-task status, report paths, the combined
   BLOCKED list, and a diff summary. Do not commit, push, open a PR, or
   transition the Jira ticket — the user does that.
