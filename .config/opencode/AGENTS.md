# Working style

- Be concise. Answer directly, with no filler and no restating of the question.
- Push back on a design decision when you see a concrete problem or a simpler
  alternative, and say why.
- Store all temporary files in `/private/tmp`.
- Make code changes in a git worktree (use the `git-worktree-setup` skill). The
  worktree goes where the skill puts it, next to the repo. Edit dotfiles in
  `~/config` in place.
- Use the `gh` CLI for everything related to GitHub. For GitHub Issues work
  (work queue, triage), use the `github-issues` skill.

## Wording

Write documentation, comments, and other prose in ASD-STE100 Simplified
Technical English for about 80% of the content.

## Writing code

- On an existing codebase, make the minimum change that adds or updates the
  behavior. Refactor only when it is strictly needed or the user asks for it.
- Write the simplest code a human can read at a glance: direct control flow,
  shallow indirection, specific helpers instead of generic ones.
- Use human-readable variable names of 20 characters or fewer. Use a longer
  name only when it is strictly necessary.

# Delegation

Parallelize by default. Before executing a multi-step task, shape it as
independent work: multiple `explore` subagents for codebase discovery, one
task/todo file per parallel worker for builds, all dispatched together
(`subagent` tool, or herdr panes for opencode agents). Confirm the
parallel plan with the user before spawning workers that edit files.

Route specialized work to the agent built for it:

- **Plan, spec, or design** (non-trivial): switch to the `plan` agent
  (in plan mode it runs its grilling protocol first, then turns settled
  requirements into the plan). For a dispatchable planning pass from
  another session, send the settled requirements to the `plan` agent as
  a `subtask: true` command target.
- **Creative "is this worth building" ideation**: dispatch the `brainstorm`
  subagent (`mode: all` — it also works as a primary agent in the TUI when
  you want the full interactive dialogue).
- **Code review of a branch or PR**: dispatch the `pr-reviewer` subagent.
  For a quick second opinion rather than a full review, consult the
  `advisor` (existing rules above).
- **Parallel file-editing work**: follow the `orchestrating-parallel-workers`
  skill — task files in `/private/tmp/tasks/`, `worker` subagents, advisor
  pre-flight on the task files, reports read from files.
- **Posting findings to a PR on GitHub**: dual-lock. The `pr-reviewer`
  agent never posts — it writes findings to a file and triages them with
  the user. Posting any finding as a PR comment, review, or issue is a
  separate action that **always, without exception, requires the user's
  explicit confirmation of the exact findings and destination first**,
  in a dedicated question. A yes to reviewing is never a yes to posting.
  `pull-requests.md` governs PR actions generally; this extends that rule
  to PR comments and reviews.

# Topic rules

Read the rule file before the task, and follow it:

- About to write or edit a code comment: read
  `~/.config/opencode/rules/code-comments.md`.
- About to open or update a pull request: read
  `~/.config/opencode/rules/pull-requests.md`.
- About to write tests: read `~/.config/opencode/rules/test-reuse.md`.
- About to write a plan, spec, or note for a Jira ticket: read
  `~/.config/opencode/rules/jira-notes.md`.

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

When in plan mode, the default is to load the `grilling` skill and run a
grilling session to completion before doing any exploration or writing a
plan. Requirements get settled first; the plan gets written from settled
requirements, not assumptions.

Skip the session only for menial work, and only when **all** of these hold:

1. The request names the change concretely enough that no design choice is
   left — what to do, not just what outcome to reach.
2. No new interface, schema, dependency, or cross-cutting convention.
3. Confined to a small, already-identified surface — no more than about
   three files.
4. A wrong guess is cheaply reversible: one revert, no data or state
   migration.

If that list is inconclusive, apply the frontier test instead: is there any
question whose answer could change what you write? If yes, grill.

When it is genuinely unclear, **grill.** The costs are asymmetric — an
unnecessary one-round grill costs a single exchange, while a skipped grill on
real design work costs a wrong plan and a rewrite.

An explicit request from the user — "grill me", "stress-test this", or any
other trigger the `grilling` skill recognizes — always runs the full session,
regardless of this gate.

When you do skip the session, put an `## Assumptions` section in the plan
listing what you would otherwise have asked about, so review can strike
anything wrong. That section is the substitute for the session; omit it from
plans that were grilled, where the assumptions are already settled with the
user.

When you do run the session, let the grilling skill's own termination rule set
the pace: the session ends when the frontier is empty. A one-line request
produces a one-node design tree, so it settles in a single round; a complex
request takes as many rounds as it takes. Running the session is not the same
as running many rounds.

Facts are yours to find, not the user's to answer — per the grilling skill's
own rule. When a frontier question needs something discoverable from the
filesystem or tools, dispatch the **`explore`** subagent rather than asking
the user. Name it explicitly: in plan mode the `general` subagent is denied,
so `explore` is the only fact-finding subagent actually available.

Once the frontier is empty and the user has confirmed shared understanding —
or once the gate above has let you skip the session — write the plan and
submit it for review. This section applies to plan mode only: do not carry
the grilling protocol into `build` or into subagents.

<!-- lean-ctx-rules -->
<!-- version: 11 -->

lean-ctx shadow mode: native read/search/shell calls auto-route to ctx_* — no tool-mapping needed.
File editing → the host's native edit tool (lean-ctx only handles reads).
Exclusive tools (no native trigger): ctx_compose (understand code, call first), ctx_search(action=symbol) (exact symbol), ctx_search(action=semantic) (by meaning), ctx_callgraph (callers), ctx_knowledge / ctx_session (memory).
<!-- lean-ctx-compression -->
OUTPUT STYLE: concise
- Bullet points over paragraphs
- Skip filler words and hedging ("I think", "probably", "it seems")
- 1-sentence explanations max, then code/action
- No repeating what the user said
<!-- /lean-ctx-compression -->
<!-- lean-ctx-solution -->
SOLUTION EFFICIENCY: stop at first level that applies:
skip (YAGNI) → reuse codebase → stdlib → native platform → installed dep → one-line → minimum code.
Never skip: validation, security, error handling.
<!-- /lean-ctx-solution -->
<!-- /lean-ctx-rules -->

# Per-repo personal rules

- The `repo-rules` plugin injects a `<repo-rules>` block into your
  instructions when the current repo has a mapped rules file. If that
  block is absent (plugin inactive), resolve the repo name yourself
  (`basename $(dirname $(git rev-parse --path-format=absolute --git-common-dir))`),
  read
  `~/Documents/knowledge-base/repo-map.json`, and if the repo is mapped
  (or `Eclipse/Trading/<repo>/` exists), read that folder's `rules.md`
  before making changes and treat it as authoritative alongside the
  repo's own AGENTS.md.
- When you learn something durable about a repo, follow the `growth-log`
  skill and propose the entry into the mapped service folder in
  `~/Documents/knowledge-base` — never write it into the repo itself.
- `~/notes` and the knowledge-base folders are for human and personal
  notes; only a mapped `rules.md` is auto-loaded rules.
