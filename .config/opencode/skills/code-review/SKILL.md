---
name: code-review
description: "Review code changes against master, provide structured feedback with pros, cons, suggestions, style checks, an overall score, and optionally post selected findings as GitHub review comments."
---

# Code Review

## When to Use This Skill

- User asks for a code review
- User wants feedback on code changes
- User wants a diff summary plus strengths, weaknesses, and suggestions
- User wants style, naming, or maintainability issues identified

## Workflows

1. **Gather Diffs**: Run `git diff` to compare the current branch with the master branch, and `git log` if commit history context is needed. Include uncommitted changes in the current branch.

2. **Detect Pull Request Context**: Determine whether the current branch has an open GitHub pull request.

    - Use GitHub MCP pull request discovery tools to find a pull request for the current branch.
    - If a pull request exists, read the pull request title and description with `mcp_mcp-github_pull_request_read` using `method: get`.
    - Treat the pull request title or description as the source of truth for the Jira ticket ID.
    - If you find a Jira ticket ID there, use the relevant mcp-atlassian Jira read/search tooling to load the ticket details before starting the review.
    - Include the Jira ticket summary in your review context when they help assess whether the code matches the intended change.

3. **Summarize Changes**: Output a single line stating how many files and how many lines of code were modified.

    - Example: `5 files changed, +120/-45 lines`

4. **Review Code**: Provide a structured review with:

    - **Pros** ✅: Good practices or improvements noticed.
    - **Cons** ⚠️: Problems, or bad practices identified.
    - **Suggestions / Alternatives** 💡: Provide actionable recommendations with:
        - A link to the relevant code section.
        - An improved code snippet.
    - **Style & Naming Issues** 🎨: Report any naming convention violations, spelling issues, inconsistent formatting, or linting issues.

5. **Overall Score**: Conclude with a rating out of 5 (half-stars allowed) and display it as stars.
    - Example: `Overall Score: 3.5/5 ⭐⭐⭐✩½`

6. **Ask About GitHub Comments**: If the review is for a GitHub pull request and you found actionable findings with exact file and line locations, ask the user which findings they want posted as GitHub review comments.

    - Present only findings that can be anchored to a specific changed file and line.
    - Use a numbered list so the user can confirm exactly which findings to post.
    - Do not post anything until the user explicitly confirms.

7. **Post Confirmed Findings**: After the user confirms which findings to post:

    - Ensure there is a pending review. If needed, create one with `mcp_mcp-github_pull_request_review_write` using `method: create`.
    - Post each confirmed finding as a separate `mcp_mcp-github_add_comment_to_pending_review` comment.
    - Anchor each comment to the exact file and line of the finding in the pull request diff.
    - If you mention a file, function, method, class, or code block, link that mention to the exact commit-pinned GitHub permalink.
    - Append this exact footer shape to every posted comment, resolving the model name at the time the skill runs `_created by <current model name> 🤖, confirmed by user_`.
    - If a finding cannot be mapped to a valid diff line, do not post it. Tell the user which findings were skipped and why.
    - After all requested comments are added, ask the user whether to submit the pending review. If they confirm, submit it with `mcp_mcp-github_pull_request_review_write` using `method: submit_pending` and `event: COMMENT`.
