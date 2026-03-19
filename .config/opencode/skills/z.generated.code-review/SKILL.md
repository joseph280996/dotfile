---
name: code-review
description: "Review code changes against master, provide structured feedback with pros, cons, suggestions, style checks, and an overall score."
---

# Code Review

## When to Use This Skill

- User asks for a code review
- User wants feedback on code changes
- User wants a diff summary plus strengths, weaknesses, and suggestions
- User wants style, naming, or maintainability issues identified

## Workflows

1. **Gather Diffs**: Run `git diff` to compare the current branch with the master branch, and `git log` if commit history context is needed. Include uncommitted changes in the current branch.

2. **Summarize Changes**: Output a single line stating how many files and how many lines of code were modified.

    - Example: `5 files changed, +120/-45 lines`

3. **Review Code**: Provide a structured review with:

    - **Pros** ✅: Good practices or improvements noticed.
    - **Cons** ⚠️: Problems, or bad practices identified.
    - **Suggestions / Alternatives** 💡: Provide actionable recommendations with:
        - A link to the relevant code section.
        - An improved code snippet.
    - **Style & Naming Issues** 🎨: Report any naming convention violations, spelling issues, inconsistent formatting, or linting issues.

4. **Overall Score**: Conclude with a rating out of 5 (half-stars allowed) and display it as stars.
    - Example: `Overall Score: 3.5/5 ⭐⭐⭐✩½`
