# Code comments

Do not add comments that restate what the code already says. Only add a
comment when the code alone would leave the reader without something they
need: a non-obvious *why* (a constraint, a workaround, a deliberate
trade-off), a warning about a footgun, or context that cannot be expressed in
code (a ticket/design-doc reference, a contract a caller must uphold). If the
comment would just paraphrase the next line in English, omit it — prefer
naming things clearly instead. This applies to new code and to edits of
existing code alike.

Two recurring failure modes to watch for specifically:

- **Narrating a return/branch instead of explaining it.** A comment like
  `// returns the failure so the caller can report it` next to
  `return (value, failure)` just restates the return statement and the
  caller's role, both already visible from the signature and call graph. If
  you catch yourself writing a comment that describes *what* a return,
  branch, or call does rather than a non-obvious *why*, delete it outright —
  do not just shorten it. A trimmed restatement is still a restatement.
- **Hardcoding today's caller into a general-purpose comment.** Do not name a
  specific concrete caller class/method inside a comment written in a
  general-purpose method, function, or interface implementation, even if
  that caller is the only one that exists right now. Callers can change
  without the comment being revisited, and the comment should describe the
  contract/invariant, not couple itself to whoever happens to call it today.

Before adding any comment, ask: "does this only restate the next line, or
the surrounding control flow/caller behavior that's already visible in the
code?" If yes, omit it entirely rather than trimming it.
