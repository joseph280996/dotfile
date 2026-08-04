---
name: review-pr
description: Review a GitHub pull request — rate changes, surface issues, and provide before/after suggestions formatted as collegial PR feedback. Use when user says "review pr", "review this pr", "check pr", "code review", or provides a PR link for review.
argument-hint: "PR_URL"
---

# Review PR

Review a GitHub pull request, rate the changes, and produce actionable suggestions with before/after code — worded as collegial feedback ready to post on the PR.

## Inputs

| Input | Required | Description |
|---|---|---|
| `PR_URL` | yes | Full URL to the PR (e.g. `https://code.ssnc.dev/eze/ETIN-locate/pull/72`) |
| `TICKET_ID` | no | JIRA ticket ID (e.g. `TREX-4821`) — provides business context for the review |

## Workflow

### 1. Parse the PR link

Extract `owner`, `repo`, `pr_number`, and `host` from the URL.
Support both `github.com` and enterprise hosts (e.g. `code.ssnc.dev`).

### 2. Fetch PR metadata

Use the GitHub MCP `pull_request_read` tool to get:
- Title, description, author, base/head branches
- List of changed files

If MCP is unavailable, fall back to `gh pr view {pr_number} --repo {owner}/{repo} --json title,body,author,files,commits`.

### 3. Fetch the diff

Use the GitHub MCP `pull_request_read` tool to get the full diff, or fall back to:
```
gh pr diff {pr_number} --repo {owner}/{repo}
```

### 3b. Resolve TICKET_ID

If `TICKET_ID` was not explicitly provided, attempt to extract it automatically:
1. From the PR **branch name** — match pattern `[A-Z][A-Z0-9]+-\d+` (e.g. `feature/TREX-4821-add-widget` → `TREX-4821` or `DAVOS-2519-Remove-Hardcoded-AccountId` → `DAVOS-2519`)
2. From the PR **title** — match `[TREX-4821]` or `TREX-4821:` or `TREX-4821 -` or `TREX-4821 ` prefix patterns
3. From the PR **description** — look for "Jira:", "Ticket:", or bare ticket ID references

Take the first match found. If multiple distinct ticket IDs appear, use the one from the branch name (most intentional).

### 3c. Get JIRA business context

If a `TICKET_ID` was provided or resolved from step 3b, use the Atlassian MCP tool `jira_get_issue` to fetch:
- **Summary** — what the ticket is about
- **Description** — acceptance criteria, business requirements, expected behavior
- **Issue type** — Bug, Story, Spike, etc.

Use this context to:
- Verify the PR actually addresses what the ticket requires
- Check if acceptance criteria are met by the changes
- Flag if the PR scope drifts beyond or falls short of the ticket
- Add a **Business alignment** category to the rating

If no ticket ID could be resolved (neither provided nor extracted), skip business alignment and note: "No JIRA ticket linked — consider adding one to the branch name or PR title for traceability."

If MCP is unavailable after resolving a ticket ID, note that business context was not available.

### 3d. Check PR size

Compute the total lines added + removed from the diff. Apply these thresholds:

| Diff size | Action |
|---|---|
| ≤ 400 lines | Proceed normally |
| 401–800 lines | Add a 🟡 `[nit]` noting the PR is large — suggest splitting if files span multiple concerns |
| > 800 lines | Add a 🟠 `[suggestion]` recommending the PR be split — large PRs receive lower-quality reviews and are harder to revert |

Also flag if the PR touches files across 3+ unrelated modules/directories — this often indicates mixed concerns that should be separate PRs.

Include a one-line size summary at the top of the review output:
> **Size:** ~{N} lines changed across {M} files

### 4. Analyze the changes

Review every changed file. For each file, evaluate:

| Category | What to look for |
|---|---|
| **Correctness** | Logic errors, off-by-one, null/undefined risks, race conditions |
| **Design** | Coupling introduced, separation of concerns violations, wrong abstraction layer, missing interface boundaries, alternative approaches that would be simpler or more extensible |
| **Security** | Injection, secrets, auth gaps, unsafe deserialization (OWASP Top 10) |
| **Performance** | Unnecessary re-renders, N+1 queries, unbounded loops, missing memoization, memory leaks (unsubscribed listeners/subscriptions/timers), heavy imports that should be lazy-loaded, expensive operations (deep clones, regex compilation, serialization) in hot paths or render cycles |
| **Readability** | Naming, complexity, dead code, magic numbers, missing context |
| **Testing** | Missing test coverage, untested edge cases, brittle assertions |
| **Style** | Inconsistency with repo conventions, formatting, import ordering |
| **Traceability** | JIRA ticket IDs left in code comments (e.g. `// ETIN-3109: ...`) — these belong in the PR/commit, not the source. Flag them for removal |
| **Business alignment** | *(only when TICKET_ID resolved)* Does the PR fulfill the ticket's requirements? Scope creep? Missing acceptance criteria? |

> **Design review guidance:** Ask yourself — "If I had to maintain this code in 6 months, would the structure make sense?" Look for:
> - God objects or functions doing too many things
> - Business logic leaking into UI/controller layers
> - Tight coupling that would make future changes cascade
> - Missed opportunities to reuse existing abstractions in the codebase
> - New abstractions introduced for one-time operations (over-engineering)

> **JIRA IDs in code comments:** Scan every added/changed comment for ticket references (regex like `[A-Z][A-Z0-9]+-\d+`, e.g. `ETIN-3109`, `IMST-123`). If found, raise a 🟡 `[nit]` suggesting removal — the *why* behind the change is valuable and should stay, but the bare ticket ID is noise that goes stale (ticket gets closed/moved) and belongs in the commit message or PR, not the source. Suggest keeping the explanatory comment and dropping just the `TICKET-ID:` prefix.

### 5. Rate the PR

Give an overall score out of 10 with a one-line rationale:

```
**Overall: 7/10** — Solid implementation, but the error handling in the new service could be tighter and one edge case is untested.
```

Also rate each category (Correctness, Design, Security, Performance, Readability, Testing, Style) on a simple scale: ✅ Good · ⚠️ Needs attention · ❌ Blocking issue.

### 6. Produce suggestions

Every finding gets a **color-coded severity tag** so the author can triage at a glance. Use this scale:

| Tag | Severity | When to use |
|---|---|---|
| 🔴 `[blocking]` | Critical / Blocker | Bugs, security holes, data loss, broken behavior — must fix before merge |
| 🟠 `[suggestion]` | Important | Real improvements worth making: trade-offs, missing edge cases, weak tests |
| 🟡 `[nit]` | Minor | Style, naming, churn, cosmetics — author's discretion |
| 🟢 `[praise]` | Positive | Call out something done especially well (optional, sprinkle sparingly) |

Lead every finding's heading with the matching emoji + tag. For each finding, format as a collegial PR comment:

```markdown
### 🟠 [suggestion] {file}:{line range}

**Issue:** {brief description of the problem}

**Before:**
```{lang}
{existing code from the diff}
```

**Suggested:**
```{lang}
{improved code}
```

**Why:** {explanation — keep it friendly and constructive, e.g. "This could cause X when Y happens. Wrapping it in Z would handle that gracefully."}

---


Guidelines for tone:
- Frame as suggestions, not demands ("Consider…", "What do you think about…", "Might be worth…")
- Acknowledge what's done well before suggesting improvements
- Explain the *why* — don't just say "change this"
- Always lead with the color-coded severity tag (🔴 `[blocking]` · 🟠 `[suggestion]` · 🟡 `[nit]` · 🟢 `[praise]`) so priority is obvious at a glance

### 7. Present the review

Structure the output as:

1. **PR Summary** — one-paragraph recap of what the PR does
2. **What's done well** — 2–3 things the author did right (be specific). **Always** prefix each bullet with `🟢` to stay consistent with the severity tag system used in Suggestions. Example:
   - 🟢 **Clean separation of concerns.** The retry hook stays generic while domain logic lives in the caller…
   - 🟢 **Thorough edge-case coverage.** Tests cover partial overlap, lookup failure, and null-fill paths…
3. **Overall rating** — score + category breakdown
4. **Suggestions** — ordered by severity, most severe first (🔴 blocking → 🟠 suggestion → 🟡 nit), each led by its color-coded tag
5. **Verdict** — one of: `Approve`, `Approve with nits`, `Request changes`

Optionally open the Suggestions section with a one-line severity tally so the author sees the shape of the review immediately, e.g. `🔴 1 blocking · 🟠 2 suggestions · 🟡 3 nits`.

### 8. Offer to post

Ask the user:
> Want me to post these suggestions as review comments on the PR?

If yes, use the GitHub MCP PR review workflow:
1. `pull_request_review_write` with method `create` to start a pending review
2. `add_comment_to_pending_review` for each file-specific suggestion
3. `pull_request_review_write` with method `submit_pending` to submit as `COMMENT` or `REQUEST_CHANGES` based on the verdict

If MCP is unavailable, print each comment in a copy-paste-ready format.
