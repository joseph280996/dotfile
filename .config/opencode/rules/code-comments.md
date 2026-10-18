# Code comments

Keep comments brief, ideally one line. Leave self-explanatory code without a
comment. A function or class may have one short line that says what it does or
what it is for; no long paragraphs.

Anything beyond that line may only carry something the code cannot say: a
non-obvious *why* (a constraint, a workaround, a deliberate trade-off), a
warning about a footgun, or external context (a ticket/design-doc reference, a
contract a caller must uphold). If deleting the comment loses nothing, the
comment must not exist. Test code is not exempt: `// Arrange` / `// Act` /
`// Assert` labels and comments narrating what a stub returns are the same
violation.

Three failure modes to watch for:

- **Narrating instead of explaining.** A comment that restates the parameters,
  return value, body, or call graph ("takes the X and returns the Y so the
  caller can report it", "logs start and end of the call") is already visible
  in the code. Beyond the one allowed purpose line, a *what* comment gets
  deleted outright, not shortened — a trimmed restatement is still one. When
  naming things clearly would remove the need for the comment, do that
  instead.
- **Hardcoding today's caller.** Do not name a specific caller
  class/method inside a general-purpose function or interface implementation,
  even when it is the only one today. Callers change without the comment being
  revisited; describe the contract or invariant, not whoever calls it now.
- **Attributing a change to a person or review thread.** Do not write "bogu's
  review comment", "per PR #902", "as discussed in review". The code outlives
  the review thread; state the invariant, the bug that would otherwise recur,
  or the trade-off directly. A stable ticket ID for genuinely open follow-up
  is fine (`// see IMSTR-1234`); a reviewer's name or review-thread reference
  is not.
