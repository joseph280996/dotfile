---
name: resiliency-review-walkthrough
description: >
  Companion to the `resiliency-review` skill. Walks the user through the executive-summary
  table produced by `resiliency-review` (or any similar findings doc / risk register), one
  row at a time. For each finding, summarizes the issue, then presents six disposition
  options (Intentional / Known no-fix / Create ticket / Aggregate ticket / No action /
  Discuss). Updates the table with the chosen disposition, re-assesses severity based on
  any new context the user surfaces, and moves on. Use whenever the user wants to triage,
  walk through, dispose of, or "go through one by one" a resiliency review, exec summary
  of findings, risk register, vulnerability list, or audit table — even if they don't say
  "resiliency". Trigger on phrases like "walk me through these findings", "go through the
  exec summary", "triage these issues", "review the risks one by one", "dispose of each row".
license: Proprietary
metadata:
  author: "@ewortzman"
  version: "1.0.0"
  tags: "resiliency,triage,walkthrough,findings,risk-register,disposition"
  scope-roles: "dev"
compatibility: >
  Designed to consume the output of the `resiliency-review` skill (an `## Executive Summary`
  markdown table of findings), but also works on any similar findings table — security
  reviews, audit reports, risk registers. Optionally uses a Jira MCP server for ticket
  creation. Without Jira MCP, ticket-creation options gracefully degrade to drafting the
  ticket inline.
---

# Resiliency Review Walkthrough

Companion to the `resiliency-review` skill. Where `resiliency-review` *generates* the findings doc, this skill *triages* it — driving a structured, row-by-row walkthrough of the executive-summary table. The user owns the call on each row; this skill's job is to **summarize the finding clearly, present the choices, capture the decision, and update the document** — then move on without prompting for unrelated work.

This skill exists because triaging a 10-row findings table is repetitive: find the row, re-read the supporting section, present options, write down the decision, re-assess severity, repeat. Doing it manually is error-prone (rows get skipped, severity columns drift out of sync with the new context, the user forgets which option they picked three rows ago). Doing it as a guided loop is faster and produces a cleaner artifact.

---

## Invocation

The user typically asks something like:

- "Walk me through the findings in `docs/resiliency-review.md`"
- "Let's go through the exec summary one by one"
- "Triage each row of this risk register"
- "Let's address each vulnerability"
- "Walk me through this resiliency review"

If the user doesn't name a file, look for `docs/resiliency-review.md` in the current repo first. If multiple candidates exist (e.g. several reviews in `docs/`), ask which one. If none exist, ask the user to point at the file.

---

## Inputs and assumptions

- **Source document**: a markdown file with an `## Executive Summary` (or similar) section containing a table of findings. Each row should have at least: a finding identifier (number or title), a severity, and a description. Other columns (blast radius, evidence, recommended action, etc.) are common and should be preserved.
- **Disposition column**: the table may or may not already have a `Disposition` column. If it does not, add one as the rightmost column before starting the walkthrough.
- **Supporting detail**: the rest of the document usually has a deeper section per finding. Use it as context when summarizing each row.

If the document doesn't fit this shape (e.g. no exec summary table), tell the user, and ask whether to (a) build one from the rest of the document or (b) point at a different file.

---

## The loop

For each row in the executive summary table, top-down:

### Step 1 — Summarize the finding

Give the user a tight, fresh summary of the finding. Don't just re-read the row verbatim — synthesize it with the supporting section so the user remembers what it's about.

**Render the summary as a clearly-bounded block so the user can scroll back through the chat and find it later.** The block is the visual anchor for this row — it should pop out of the conversation flow.

Use this exact template:

````markdown
```
╔══════════════════════════════════════════════════════════════════╗
║                                                                  ║
║   📋  FINDING #N  —  <SHORT TITLE>                               ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
```

| | |
|---|---|
| **Severity** | <emoji> **<SEVERITY>** |
| **Where** | <single `file:line` inline if one ref, else a `<br>`-separated bulleted list — see rule below> |
| **Disposition** | <empty / existing value> |

### What
<one or two sentences describing the issue>

### Why it matters
- <failure mode 1 — what breaks, who notices, when>
- <failure mode 2>
- <failure mode 3 if relevant>

<optional one-liner — only if relevant nuance exists in the supporting section that didn't fit above. e.g. *"More nuance available — pick option 6 (Discuss) for the deeper trace."*>

---
````

Rules for the block:

- **The ASCII title box is a fenced code block.** This is critical — the box characters (`╔ ╗ ╚ ╝ ║ ═`) only render aligned in monospace. A code fence guarantees monospace rendering. Outside a fence the box will look broken on most renderers.
- **Box width.** Use a fixed inner width of 64 characters (so the full line including borders is 68). Center the title within the inner width by padding both sides with spaces. If the title is longer than 60 chars, shorten it — don't widen the box, since wider boxes wrap on narrow terminals.
- **Box content.** One blank line above the title, one below, for breathing room. Format: `║   📋  FINDING #N  —  TITLE                                       ║`. Title in ALL CAPS for visual weight (the source title can be mixed case; the box version uppercases it).
- **Trailing horizontal rule** below the "Why it matters" list closes the block visually. Don't omit it — it's the bottom edge of the row's section.
- **Metadata table** sits directly under the title box. Two-column borderless markdown table renders as a clean key-value list.
- **Severity emoji** by level: 🔴 CRITICAL, 🟠 HIGH, 🟡 MEDIUM, 🟢 LOW, ⚪ INFO. Pair the emoji with the bold severity word.
- **Where field.** If there's only one reference, render it inline: `` `file:line` ``. If there are multiple, render them as a bulleted list inside the same table cell — markdown renders `<br>•&nbsp;` (or a `<ul>`) inside a cell, but the simplest portable form is `<br>• \`file:line\`` repeated. Keep to 1–4 refs total — enough to anchor, not enough to overwhelm.
- **What** is ~2 sentences, prose. Don't bullet it.
- **Why it matters** is a bulleted list of failure modes. Bullets are easier to scan than a paragraph and force you to enumerate the distinct concerns.
- **Whole block on one screen.** Keep the block compact. If a finding has additional nuance that doesn't fit (a longer trace, a subtle interaction, an alternate framing), don't try to cram it in — but **do call out that more nuance exists**. Add a one-line nudge after "Why it matters" like *"More nuance available — pick option 6 (Discuss) for the deeper trace."* The user shouldn't have to guess that there's more depth available.
- After the block, immediately render the Step 2 prompt below it.

### Step 2 — Present the disposition options

**Do not use `AskUserQuestion` for this prompt.** That tool caps at 4 options, but the disposition prompt has 6. A plain-text prompt also lets the user reply naturally ("intentional, the reason is …") in a single message instead of being forced through a select-then-elaborate two-step.

Render the prompt as a compact table directly after the summary block. The table format keeps the options visually grouped and makes the numbers the unmistakable response key. Use this exact template (wording may be lightly adjusted, but the **semantics and numbering must stay stable** so users develop muscle memory across walkthroughs):

```markdown
### How do you want to dispose of this finding?

| # | Option | Meaning |
|---|---|---|
| **1** | ✅ **Intentional** | Deliberate behavior, not a bug or vulnerability |
| **2** | 🔒 **Known / no-fix** | Known problem, no plan to fix (will ask why) |
| **3** | 🎫 **Create ticket** | File a Jira ticket (will ask which project) |
| **4** | 📦 **Aggregate ticket** | Bundle with other rows into one combined ticket (filed at end) |
| **5** | 👀 **No action** | Acknowledged but no ticket; not intentional/known-no-fix |
| **6** | 💬 **Discuss** | Dive deeper, then circle back to these options |

_Reply with a number (and any context you want captured)._
```

Behavior per option:

1. **Intentional** — record in disposition column. Optionally ask the user to briefly say *why* it's intentional and capture that reason. If the user already gave the reason in their reply, skip the follow-up.
2. **Known / no-fix** — **always** ask *why* it's not being fixed (cost, risk, prioritization, deferred to a later effort). Capture in the disposition. Without the reason, "no-fix" is a shrug — the reason is the load-bearing part. If the user already gave the reason in their reply, skip the follow-up.
3. **Create ticket** — file a Jira ticket.
   - If the user has a default Jira project saved in memory (or has expressed one in this conversation), use it. Otherwise, ask which project to file in.
   - If a Jira MCP server (e.g. `mcp__atlassian-public__createJiraIssue` or similar) is available, create the ticket and put the ticket URL/key in the disposition column.
   - If no Jira MCP is available, draft the ticket (title, description, severity) inline and record `Ticket TBD — drafted in conversation` in the disposition. Tell the user the MCP wasn't available so they can file it themselves.
4. **Aggregate ticket** — bundle with other aggregate rows.
   - Don't file the ticket immediately. Hold a running list of aggregate-bound findings.
   - Record the disposition as `Aggregate ticket (pending)` for now.
   - At the end of the walkthrough, ask whether to create the aggregate ticket. If yes, draft a single ticket whose body lists all aggregate-bound findings with their summaries and severities, then create it via Jira MCP (or draft inline if no MCP). Update each aggregate row's disposition with the resulting ticket key/URL.
5. **No action** — the issue is acknowledged but the user explicitly does not want a ticket, and it isn't intentional or known-no-fix either. This is a real category — sometimes the user just wants the row in the document and isn't ready to commit to anything. Record the disposition as `No action — acknowledged`.
6. **Discuss** — open a free-form sub-conversation. The user may ask questions, request a deeper trace, ask "what would the fix look like", etc. **After the discussion concludes, return to Step 2** and re-present the same six options. Don't loop on Discuss forever — but do let the user dig as deep as they want before committing.

**Liberal parsing of replies.** A reply like `1` is option 1. A reply like `intentional, splunk alerts cover us` is option 1 plus the reason — capture both, no follow-up needed. A reply like `lets discuss` is option 6. If the reply is genuinely ambiguous, ask once for clarification rather than guessing.

### Step 3 — Re-assess severity

After the user picks a disposition (1–5), reconsider whether the severity recorded in the table still fits, given the new context:

- If the user explained that an apparent CRITICAL is actually **Intentional** with an alerting / mitigation story, the real severity may drop (e.g. CRITICAL → HIGH, or HIGH → MEDIUM).
- If the user revealed that a MEDIUM is actually **Known / no-fix** for a load-bearing reason that increases blast radius (e.g. "we never fixed it because the team that owns it disbanded"), severity may rise.
- If the user simply chose **Create ticket** without new context, severity probably stays the same.

Don't change severity arbitrarily — only if the conversation produced a real reason. When you do change it, render the cell as `<original> → <new>` so the history is preserved (e.g. `CRITICAL → HIGH`).

### Step 4 — Update the document

Edit the source file in place:

- Add or update the `Disposition` column for this row with a concise entry that captures both the choice and the reasoning. Examples:
  - `Intentional. Fire-and-forget HTTP jobs by design; failures surface via Splunk dashboards and alerts.`
  - `Known / no-fix. Multi-year track record without incident; not prioritized.`
  - `Ticket: USD-1234`
  - `Aggregate ticket (pending)` → later resolved to `Aggregate ticket: USD-1240`
  - `No action — acknowledged.`
- If severity changed, update the severity column with `<original> → <new>`.
- Save the file with a single `Edit` tool call per row when possible — don't batch up edits, since the user may want to bail out partway through.

### Step 5 — Move on

After updating, briefly confirm what was recorded (one short sentence) and immediately summarize the next row. Don't ask "ready to continue?" between rows — momentum matters. The user will say "stop" or "let's pause here" if they want a break.

When the last row is done, do the aggregate-ticket wrap-up (if any aggregate-bound rows exist), then give a one-paragraph summary of the walkthrough: how many rows by disposition, anything escalated, any pending tickets.

---

## Important behaviors

### Capture the *why*, not just the choice

The disposition column is most valuable to readers six months later when they're trying to understand *why* a known issue was left unfixed or why a CRITICAL was downgraded. A bare "intentional" or "no-fix" rots fast — capture the user's reasoning verbatim or near-verbatim in the cell.

### Earlier framing may be wrong

While walking through a row, you may discover (by reading the supporting section more carefully, or because the user explains something) that the original write-up of the finding was wrong or incomplete. When that happens:

- Don't silently rewrite the finding to match the new understanding.
- Add a note to the disposition cell or in the supporting section explicitly acknowledging the correction. e.g. `Earlier framing of this as "silent auth bypass" was incorrect — the consumer fails closed.`
- This protects against losing the audit trail of what the original review said vs. what was decided after discussion.

### Severity history matters

Use `<original> → <new>` notation when severity changes. Don't overwrite. Reviewers comparing the doc against earlier versions need to see *that* a change happened, not just the current value.

### Pacing

One row at a time. Don't summarize three rows ahead. Don't try to batch dispositions ("let's mark rows 4, 5, and 6 all intentional"). Even if the user says "they're all the same", walk through each one — the row-by-row pace catches the case where one of them isn't actually the same.

The exception: if the user explicitly says *"just mark all the rest as no action and we're done"* or similar, take that instruction at face value and update the table in one batch, then exit.

### Discuss → return

When the user picks Discuss, fully engage with whatever they want to dig into — read more files, decompile binaries, trace call sites, whatever the depth requires. When the discussion winds down (the user gives a verdict like "ok, intentional then" or "let's ticket that"), return to the disposition prompt and capture the choice. Don't lose the row.

### When Jira MCP is missing

Detect availability by looking for a tool whose name matches `mcp__*createJiraIssue` (or similar — e.g. Atlassian Public MCP exposes `mcp__atlassian-public__createJiraIssue`). If one is present, use it. If not, draft the ticket content inline (title, description, suggested project, suggested severity/priority) and tell the user explicitly: *"No Jira MCP available — here's the drafted ticket content for you to file."* Then record `Ticket TBD — drafted in conversation` in the disposition.

### Aggregate ticket bookkeeping

Maintain the running list of aggregate-bound findings in your own context (or as a temporary scratchpad in the document if needed). At wrap-up, the aggregate ticket should:

- Have a single title that names the cluster (e.g. *"Resiliency review: cluster of medium-severity timeout/retry consistency gaps"*)
- List each finding's number, title, and severity in the body
- Link back to the resiliency-review.md document
- Be filed in the user's default Jira project from memory if one is saved, otherwise ask which project

After the aggregate ticket is created, walk back through the aggregate rows and replace `Aggregate ticket (pending)` with `Aggregate ticket: <KEY>` in each.

---

## Output

The skill modifies the source document in place. It produces no separate output file. At the end of the walkthrough, summarize the dispositions inline:

```
Walkthrough complete.
- 8 findings reviewed
- 2 Intentional (rows 1, 4)
- 1 Known / no-fix (row 2)
- 3 Create ticket → USD-1234, USD-1235, USD-1236 (rows 3, 6, 8)
- 1 Aggregate ticket → USD-1240 (rows 5, 7)
- 1 No action (row 9)
- Severity changes: 1: CRITICAL → HIGH, 2: CRITICAL → MEDIUM, 6: HIGH → MEDIUM
```

---

## Example — abbreviated trace

> **Skill**: Finding 1 — *Fire-and-forget HTTP jobs* (CRITICAL). The job handler kicks off `MakeHttpRequest` via `Task.Run` and returns immediately; the surrounding scheduler treats the job as successful regardless of whether the HTTP call ever lands. Lives in `ResourceJob.cs:311`. Failures don't propagate back to the scheduler. How do you want to dispose of this one?
>
> *(presents 6 options)*
>
> **User**: Intentional. We have Splunk alerts on the eventual failures.
>
> **Skill**: Got it. Re-rating CRITICAL → HIGH given the alerting safety net. Updating row 1 disposition to *"Intentional. Fire-and-forget by design; failures surface via Splunk dashboards and alerts."*
>
> *(edits document, moves to row 2)*
>
> **Skill**: Finding 2 — *Non-clustered Quartz with `useDBLocks=true`* (CRITICAL). …

---

## When NOT to use this skill

- The user wants to *generate* a resiliency review (use `resiliency-review` instead).
- The user wants to discuss findings broadly without committing to dispositions ("just talk me through them" — no decisions).
- The document doesn't have an exec-summary-style findings table.
