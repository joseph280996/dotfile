# Jira notes: where plans, specs, and notes go

Applies to any plan, spec/design doc, investigation write-up, or note you write for the user to read about a Jira ticket.

## Location

`~/notes/TRAD/Jiras/<last4>/<type>/YYYY-MM-DD-<FULL-KEY>-<slug>.md`

- `<last4>`: the last 4 digits of the issue number (`IMSTR-16156` → `6156`).
- Always `TRAD`, whatever the project key is.
- `<type>`: `plans/`, `specs/`, or `notes/`. Investigation notes go in `notes/`.
- `<slug>`: short kebab-case topic.
- Create missing folders. If a file for the same ticket, date, and topic already exists, update it instead of creating a duplicate.

Example: `~/notes/TRAD/Jiras/6156/plans/2026-09-29-IMSTR-16156-orders-grid-unsubscribe.md`

## Finding the Jira key

Look for a key (`[A-Z][A-Z0-9]+-\d+`) in this order: the user's message, then the git branch or worktree name, then the session title. If none has one, ask the user once. If there is no Jira, write to the knowledge-base (`~/Documents/knowledge-base`).

## Superpowers skills

This is the user's location preference that overrides the superpowers defaults:

- `writing-plans`: save to `.../<last4>/plans/` instead of `docs/superpowers/plans/`.
- `brainstorming`: save to `.../<last4>/specs/` instead of `docs/superpowers/specs/`, keeping the `-design` suffix.
- Skip the brainstorming commit step. Tell the user the file path instead.

## Never

- Commit in `~/notes`. The user commits notes themselves.

## Out of scope (leave where the workflow puts them)

- Harness-managed plan files: `~/.opencode/plan`, `~/.plannotator/plans`.
- Files that a workflow reads back later: agent-orch `ssnc-agent-orch/**/PLAN.md` and `STATUS.md`, meta-orch `docs/tech-specs/` and `docs/tech-plan/`, `docs/c4/`, `docs/adr/`.
- Docs the user explicitly asks to put in the repo.
