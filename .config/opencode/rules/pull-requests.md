# Opening pull requests

## Title and body

Title: the Jira key, a dash, then a brief title.
Example: `TREX-12345 - Fixing Handling Of Executions With No Broker`

Keep the body brief, with these headers:

- `## Description`: a brief reason for the PR.
- `## Related JIRA / Resources`: the Jira link, plus links to resources that
  help explain the PR.
- `## Testing`: the steps you ran to test the PR, locally and in CASTLE.
- `## Additional Comments`: optional. Use it only to list other services that
  this change affects.

**Non-negotiable: never open, close, merge, or reopen a pull request
without the user's explicit confirmation for that specific action.**
Doing anything on a shared platform that other people will see —
opening a PR, creating issues, publishing branches for review — is a
side effect outside the working machine and outside the scope of any
approval the user gave for the code itself. Nothing in a plan
precedent, a prior PR, a workflow stage, or the user's choice among
implementation options counts as permission; a question offering
"fix X then push and open the PR" as one bundle does not create
permission for each bundled step. An unchosen option remains unchosen.

Before any PR action, ask the user in a dedicated question whose only
options concern that action, and proceed only on their explicit yes.
**Posting review findings as PR comments or reviews is a PR action** under
this rule: confirm the exact findings and destination with the user first,
every time, regardless of who produced the findings. The agent may prepare everything up to the boundary — commits, push of
a feature branch if (and only if) the user approved it for this piece
of work, a PR title and description saved locally — but the PR itself
stays unopened until the user says so. When the user grants permission
for one PR, that grant covers that PR only; the next one asks again.
If the user declines, or a PR was opened in error, close the PR
immediately and then report the mistake plainly.
