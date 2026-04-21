---
name: cypress-test-fixer
description: "Fix unit test compilation or runtime errors"
---

# Cypress Test Fixer

## When to Use This Skill

- User asks to fix broken cypress tests
- A recent code change broke cypress tests
- User wants iterative test repair with human-readable failure summaries

## Rules

1. Always create an implementation plan and confirm with the user, before making code changes.
2. Show summarized diffs and error outputs in a clean, human-readable format.
3. Suggest minimal and safe fixes first, avoiding unnecessary rewrites.
4. Iterate step by step until all compilation errors and test failures are resolved.
5. Prioritize test consistency with recent code changes from the diff.
6. Cleanup any temp or backup files created

## Context

User extra context: $2

## Workflows

User specific cypress spec to fix: $1

All commands below should focus on the specific spec file provided by the user,
and related source code changes from the diff. If there is no spec provided,
these steps applies to all failed specs.

1. **Gather Diffs**

    - Run `git diff` to compare the current branch with the master branch.
    - Run `git log` to receive context.
    - Include uncommitted changes.
    - Summarize the changes.

2. **Detect Build Errors**

    - Compile cypress tests.
    - Identify compilation errors in cypress tests.
    - Map failing tests to related source code changes.
    - Fix compilation errors in cypress tests.
    - Repeat until all compilation errors are resolved.

3. **Run Cypress test to gather **

- Spawn subagent localrunner to run the cypress tests locally.

4. **Suggest Fixes**

    - Consult spechealer agent to analyze test failures and suggest fixes.
    - Use brainstorming superpower to validate and identify gaps with the
      spechealer suggestions.
    - If any issue identified, redo the whole process with additional context
      until no issue identified.

5. **Plan on execution plan**

- Update plan.md and tasks.md with the proposed fixes by spechealer and
  brainstorming superpower.

6. **Apply Fixes**

    - Use /speckit.implement command to apply the fixes in tasks.md.
    - Use subagent-driven-development skill to implement the parallel tasks in
      order with sequential tasks.

7. **Iterate Until Green**
    - Repeat steps 4–7 until all test failures are resolved.
