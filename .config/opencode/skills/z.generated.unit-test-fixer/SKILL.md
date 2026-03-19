---
name: unit-test-fixer
description: "Fix unit test compilation or runtime errors"
---

# Unit Test Fixer

## When to Use This Skill

- User asks to fix broken unit tests
- A recent code change broke unit tests
- User wants iterative test repair with human-readable failure summaries

## Rules

1. Always create an implementation plan and confirm with the user, before making code changes.
2. Show summarized diffs and error outputs in a clean, human-readable format.
3. Suggest minimal and safe fixes first, avoiding unnecessary rewrites.
4. Iterate step by step until all compilation errors and test failures are resolved.
5. Prioritize test consistency with recent code changes from the diff.
6. Cleanup any temp or backup files created

## Workflows

1. **Gather Diffs**

    - Run `git diff` to compare the current branch with the master branch.
    - Run `git log` to receive context.
    - Include uncommitted changes.
    - Summarize the changes.

2. **Detect Build Errors**

    - Identify compilation errors in unit tests.
    - Map failing tests to related source code changes.

3. **Suggest Fixes**

    - Propose fixes for compilation errors based on diffs.
    - Ask user for confirmation before applying changes.

4. **Apply Fixes**

    - Make targeted code edits in unit tests to fix compilation errors.

5. **Iterate Until Compilation Errors Fixed**

    - Repeat steps 2–4 until all compilation errors are resolved.

6. **Run Tests**

    - Compile and run unit tests.
    - If failures exist, summarize failed tests and suggest fixes.
    - Confirm with user before applying changes.

7. **Apply Fixes**

    - Make targeted code edits in unit tests to fix failed tests.

8. **Iterate Until Green**
    - Repeat steps 5–7 until all test failures are resolved.
