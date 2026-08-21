<!-- context7 -->
Use the `ctx7` CLI to fetch current documentation whenever the user asks about a library, framework, SDK, API, CLI tool, or cloud service -- even well-known ones like React, Next.js, Prisma, Express, Tailwind, Django, or Spring Boot. This includes API syntax, configuration, version migration, library-specific debugging, setup instructions, and CLI tool usage. Use even when you think you know the answer -- your training data may not reflect recent changes. Prefer this over web search for library docs.

Do not use for: refactoring, writing scripts from scratch, debugging business logic, code review, or general programming concepts.

## Steps

1. Resolve library: `npx ctx7@latest library <name> "<user's question>"` — use the official library name with proper punctuation (e.g., "Next.js" not "nextjs", "Customer.io" not "customerio", "Three.js" not "threejs")
2. Pick the best match (ID format: `/org/project`) by: exact name match, description relevance, code snippet count, source reputation (High/Medium preferred), and benchmark score (higher is better). If results don't look right, try alternate names or queries (e.g., "next.js" not "nextjs", or rephrase the question)
3. Fetch docs: `npx ctx7@latest docs <libraryId> "<user's question>"`
4. Answer using the fetched documentation

You MUST call `library` first to get a valid ID unless the user provides one directly in `/org/project` format. Use the user's full question as the query -- specific and detailed queries return better results than vague single words. Do not run more than 3 commands per question. Do not include sensitive information (API keys, passwords, credentials) in queries.

For version-specific docs, use `/org/project/version` from the `library` output (e.g., `/vercel/next.js/v14.3.0`).

If a command fails with a quota error, inform the user and suggest `npx ctx7@latest login` or setting `CONTEXT7_API_KEY` env var for higher limits. Do not silently fall back to training data.
<!-- context7 -->

# lean-ctx — Context Engineering Layer
<!-- lean-ctx-rules-v11 -->

## Tool Mapping (MANDATORY — use instead of native equivalents)
| Instead of | Use | Example |
|------------|-----|---------|
| Read/cat/head/tail | `ctx_read(path, mode)` | `ctx_read("src/main.rs", "full")` |
| Grep/rg/find | `ctx_search(pattern, path)` | `ctx_search("fn handle", "src/")` |
| Shell/bash | `ctx_shell(command)` | `ctx_shell("cargo test")` |
| Edit (when Read unavailable) | `ctx_edit(path, old, new)` | `ctx_edit("f.rs", "old", "new")` |

## ctx_read Mode Selection
| Goal | Mode | When |
|------|------|------|
| Edit this file | `full` | Before any edit |
| Understand API | `signatures` | Context-only, won't edit |
| Re-read after edit | `diff` | Post-edit verification |
| Large file overview | `map` | >500 lines, won't edit |
| Specific region | `lines:N-M` | Know exact location |

## Workflow (follow this order)
1. **Orient:** `ctx_overview(task)` or `ctx_compose(task, path)` for unfamiliar tasks
2. **Locate:** `ctx_search(pattern, path)` for exact text; `ctx_semantic_search(query)` for concepts
3. **Read:** `ctx_read(path, mode)` with appropriate mode from table above
4. **Edit:** `ctx_edit(path, old_string, new_string)` or native Edit if available
5. **Verify:** `ctx_read(path, "diff")` + `ctx_shell("test command")`
6. **Record:** `ctx_knowledge(action="remember", content="...")` for non-obvious findings

## Proactive (use without being asked)
- `ctx_overview(task)` — at session start for orientation
- `ctx_compress` — when context grows large (at phase boundaries)
- `ctx_knowledge(action="wakeup")` — at session start to surface prior findings

## Compression Bypass (only when compressed output hides needed detail)
`ctx_read(path, "lines:N-M")` → `ctx_read(path, "full")` → `ctx_shell(cmd, raw=true)`
Return to compressed defaults after one expanded retrieval.

## Risk Gate (before high-impact edits)
Before editing exported symbols, auth, DB schemas, or 3+ files: run `ctx_impact(action="analyze")`
and `ctx_callgraph(action="callers")` to confirm blast radius.

## Session
- **Start:** `ctx_session(action="status")` + `ctx_knowledge(action="wakeup")`
- **End:** `ctx_session(action="decision", content="what was done + next steps")`
- **On [CHECKPOINT]:** `ctx_session(action="task", value="current status")`

NEVER use native Read/Grep/Shell when ctx_* equivalents are available.
<!-- /lean-ctx -->

# Advisor available

A stronger advisor model is available through the `advisor` subagent. Consult it
by dispatching that subagent at these decision points:

- **Before committing to an approach** on a non-trivial, multi-step task.
- **When an error recurs** — if the same failure appears two or more times.
- **Before declaring a task done** — for an independent check that the goal is
  genuinely met.

The advisor cannot use write or edit tools and cannot dispatch subagents; its
shell access is for inspection only (`git status`, `git diff`, `grep`) and is
constrained by its prompt rather than enforced. It verifies claims against the
live workspace rather than trusting your account of it. Give it enough context to
work from: the pending decision, the relevant file paths, and what you have
already tried.

The advisor is a **background mechanism**, not a user-facing feature. When a
consult is warranted, just do it (dispatch the subagent) — do **not** ask the
user for permission to consult, and do **not** list "consult the advisor" as an
option in a menu of next steps. The user never needs to decide whether you use
it; that is your judgment. The user can, of course, still request one explicitly
by mentioning `@advisor`.

Do not consult on trivial, single-step requests. Apply the advisor's guidance,
but do not silently drop a point you disagree with. When you disagree with any
advisor point, **re-engage the advisor once** rather than just overriding it:

- **If you can verify the advisor is wrong** (it read the wrong file, the code or
  a failing step contradicts it), hand that **evidence** back to the advisor and
  let it reconsider — don't just move on.
- **If it is a judgment call** you cannot settle with evidence, send your
  reasoning back and get the advisor's response.

Limit this to **one re-engagement round** (do not loop indefinitely). After that
round, for any point where you and the advisor still do not agree, **escalate
that specific point to the user** with both positions — this is a rare fallback,
not the norm; most disagreements resolve in the one round.

After consulting, **re-issue one consolidated, human-readable answer** — do not
leave a short reply *to the advisor* as your last message. The user often has not
seen the advisor's output and may not have re-read your pre-consult answer, so a
terse "the advisor flagged X; point A is valid, point B I disagree with" reads as
meta-commentary, not an answer. Instead, fold the points you accept back into a
single updated response that stands on its own, note any corrections inline (e.g.
"corrected: the settlement date defaults to the trade date, not unset"), and only
briefly mention where you disagreed with the advisor and why. The final message
should be the complete, current answer to the user's actual request.

Keep "I need input from the user to proceed" separate from "here is optional
follow-up work." If you must ask a blocking clarifying question, ask it on its
own — do not bundle it under a menu of offered next steps.

If `~/.local/share/opencode/advisor-disabled` exists, skip automatic consults
entirely; the user has turned the mechanism off via `/advisor-toggle`. Explicit
`@advisor` requests still work.

# Planning

When in plan mode, before doing any exploration or writing a plan, load the
`grilling` skill and run a grilling session to completion. Requirements get
settled first; the plan gets written from settled requirements, not
assumptions.

Always run the session — do not skip it because the request looks simple.
But let the grilling skill's own termination rule set the pace: the session
ends when the frontier is empty. A one-line request produces a
one-node design tree, so it settles in a single round; a complex request
takes as many rounds as it takes. This is always-on, not always-multi-round.

Facts are yours to find, not the user's to answer — per the grilling skill's
own rule. When a frontier question needs something discoverable from the
filesystem or tools, dispatch the **`explore`** subagent rather than asking
the user. Name it explicitly: in plan mode the `general` subagent is denied,
so `explore` is the only fact-finding subagent actually available.

When the frontier is empty and the user has confirmed shared understanding,
write the plan and submit it for review. This section applies to plan mode
only — do not carry the grilling protocol into `build` or into subagents.