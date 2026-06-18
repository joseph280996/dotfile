---
name: splunk-query
description: 'construct and execute Splunk SPL queries against castle (dev) or prod environments. Given an environment, time range, and natural language description, builds the SPL, authenticates, runs the query, and presents results.'
---

# Splunk Query

## When to Use
- User asks to "query splunk" or "search splunk"
- User wants to check logs, metrics, or events in splunk
- User asks to "find in splunk" or "look up in splunk"

## Arguments
The user provides (prompt or infer from context):
- **environment**: `castle` or `prod`
- **time range**: relative (e.g. `-24h`, `-7d`, `-30m`) or absolute (e.g. `2026-03-29T00:00:00 to 2026-03-30T00:00:00`)
- **description**: what to search for, in natural language
- **timeout** (optional): max query wait time in milliseconds (default `60000`)

## Environment Map

| Environment | Splunk Host | Port |
|-------------|-------------|------|
| castle (dev) | `https://splunk-awsdev.ezesoft.net` | 8089 |
| prod | `https://splunk-awsprod.ezesoft.net` | 8089 |

## Authentication

Credentials are resolved automatically from the **OS credential store**:
   - **macOS**: Keychain (service: `splunk-nexus`)
   - **Windows**: DPAPI-encrypted file (`%USERPROFILE%\.splunk-nexus-credentials`)

### One-time credential setup

Run once to store your credentials securely in your OS:

```bash
bash scripts/run.sh scripts/setup-credentials.ts
```

- **macOS**: prompts for username and password in the terminal (password is hidden during input), stores in Keychain
- **Windows**: opens a credential dialog (GUI), stores encrypted with DPAPI (only your Windows user can decrypt)

After setup, no environment variables are needed — the scripts read credentials automatically.

### Security notes
- **NEVER** print a password into a terminal, log file, session context, or memory tool.
- Keychain credentials are encrypted by macOS and locked to your login session.
- DPAPI credentials on Windows are encrypted and tied to your Windows user account.
- Never commit credentials to git.

Auth flow:
1. Resolve credentials from OS credential store
2. POST to `{host}:{port}/services/auth/login` with `username`, `password`, `output_mode=json`
3. Extract `sessionKey` from JSON response and use `Authorization: Splunk {sessionKey}` for all subsequent requests

If port 8089 fails, retry on port 443.

**Important:** TLS verification must be disabled (`rejectUnauthorized: false` or `curl -k`).

## Procedure

### 1. Clarify Parameters
Extract environment, time range, and search description from the user's request. If ambiguous, ask. Default to `prod` and `-1h` (earliest) / `now` (latest) if the user did not mention a time frame.

When the user says "at XYZ", XYZ is usually a **firm name**, **firm auth token**, or **time** — infer from context.

### 2. Construct the SPL Query
Build a valid SPL query based on the user's description:
- Always prefix with `search` command
- Use `index=*` unless the user specifies an index
- Use `spath` to extract JSON fields from `_raw`
- Use `table`, `stats`, `timechart`, `top`, `rare` as appropriate for the ask
- For nested JSON arrays, use `spath path=arrayName{} output=varName | mvexpand varName | spath input=varName`
- Apply time range via `earliest=` and `latest=` in the SPL or via API params

Show the SPL to the user before executing.

### 3. Execute the Query
Run the reusable query script at `scripts/query.ts` (relative to this skill folder) via env vars.

**macOS / Linux:**

```bash
WORKSPACE_ROOT="$PWD" SPLUNK_HOST='<host from env map>' SPL='<constructed SPL>' EARLIEST='<earliest>' LATEST='<latest>' QUERY_TIMEOUT_MS='<timeout ms>' bash scripts/run.sh scripts/query.ts
```

**Windows PowerShell:**

```powershell
$env:WORKSPACE_ROOT = $PWD.Path; $env:SPLUNK_HOST = '<host from env map>'; $env:SPL = '<constructed SPL>'; $env:EARLIEST = '<earliest>'; $env:LATEST = '<latest>'; $env:QUERY_TIMEOUT_MS = '<timeout ms>'; powershell -ExecutionPolicy Bypass -File scripts/run.ps1 scripts/query.ts
```

The `run.sh` / `run.ps1` wrappers automatically install `bun` if it is not already present — no manual setup required.

The script handles:
- Authentication (tries port 8089, then 443)
- Retry with exponential backoff on 503 concurrency limits (up to 5 retries)
- Configurable query timeout via `QUERY_TIMEOUT_MS` (defaults to `60000`)
- Automatic cancel of long-running jobs when timeout is exceeded
- Large results (>50 rows) are saved to `tmp/` under workspace root and the path is printed
- Small results are printed inline via `console.table`

Do **not** inline the script or create a temporary copy — always run the canonical script directly.

### 4. Handle Errors
- **401 Unauthorized (expired password)**: the scripts handle this automatically:
	- **OS credential store users**: prompted inline for their new password (hidden input on macOS, GUI dialog on Windows). On success, the new password is saved and the query retries seamlessly.
	- The agent does **not** need to manually intervene — the script handles the full retry flow.
- **503 concurrency limit**: retry with exponential backoff (1s, 2s, 4s, 8s, 16s), up to 5 attempts
- **Timeout (> QUERY_TIMEOUT_MS)**:
	- `query.ts` cancels the timed-out job automatically
	- inspect whether SPL is too broad/expensive (wide `sourcetype=*`, missing keyword constraints, heavy `join`/`transaction`/full `spath` on huge windows)
	- narrow scope (time range, sourcetype, predicates), or increase `QUERY_TIMEOUT_MS` for known-complex queries
	- re-run after stuck jobs are cancelled
- **No results**: suggest broadening the time range or relaxing filters; try `sourcetype=*` with just a keyword

Manual kill command (for any known SID):

```bash
SPLUNK_HOST='<host from env map>' SPLUNK_SID='<sid>' bash scripts/run.sh scripts/kill-job.ts
```

### 5. Present Results
- If results were saved to a file under workspace-root `tmp/`, tell the user the path and show a preview
- For inline results: highlight key numbers
- Always provide a brief natural-language summary of findings
- Always print the decisive raw log lines and the exact SPL query used for each finding as evidence
- **Timezone handling**: all Splunk timestamps are in **America/New_York**. If the current machine timezone differs, always mention the difference and present times in both zones (e.g. `2026-03-30 13:00 EST / 18:00 UTC`). Detect the machine timezone via `Intl.DateTimeFormat().resolvedOptions().timeZone` or the `TZ` env var.

Evidence output must include:
- The exact SPL query text used for each decisive finding
- The raw log line(s) that directly support each finding
- Any transformed/extracted row shown next to its supporting raw line

### 6. Large Log Volume Handling
Use one of these two approaches to avoid loading too much data into context or hanging the UI:

1) File-first shape inspection
- After logs are saved to a file in `tmp/`, load only the top 5 lines into memory to inspect structure/shape.
- Based on that shape, write a focused extraction script and run it against the full log file.
- Only present extracted evidence fields (plus decisive raw lines), not the full file contents.

Example:
```bash
head -n 5 tmp/splunk-results-*.json
# then write and run an extraction script against the full file
```

2) SPL-first shape inspection
- First run a probe query with `| head 5` to inspect event shape and identify required fields.
- Then run a second query without `head`, but include `| table <fields...>` so Splunk returns only the needed fields.
- Use this second query's output as the main dataset for findings.

Example:
```spl
search index=* "keyword" earliest=-24h latest=now | head 5
search index=* "keyword" earliest=-24h latest=now | spath | table _time host level requestId message
```

### 7. Temporary File Policy and Cleanup
- Never write temporary outputs to `/tmp`.
- Always write temporary outputs under workspace-root `tmp/`.
- After presenting findings and evidence, move `tmp/` to Trash using `trash tmp/` so artifacts are recoverable if needed.

## citations
- Workspace-root tmp behavior is implemented in `scripts/query.ts:35-40` via `WORKSPACE_ROOT` and `TMP_DIR`.
- Large-result file write path and save behavior are implemented in `scripts/query.ts:231-235` output logic.
- Retry/backoff behavior for Splunk 503 concurrency limits is implemented in `scripts/query.ts:88-103` in `splunkRequest`.
- Configurable timeout and auto-cancel flow are implemented in `scripts/query.ts:22`, `scripts/query.ts:170-187`, and `scripts/query.ts:151-168`.
- Manual kill-by-SID behavior is implemented in `scripts/kill-job.ts:52-71`.
- Credential resolution (OS credential store) is implemented in `scripts/credentials.ts` (`resolveCredentials`).
- One-time credential setup for macOS Keychain and Windows DPAPI is implemented in `scripts/setup-credentials.ts`.
- Expired password detection and inline re-prompt flow is implemented in `scripts/query.ts` (`tryLogin`, `login`) and `scripts/kill-job.ts` (`tryLogin`, `login`), using `promptNewPassword` and `storeCredentials` from `scripts/credentials.ts`.
- Automatic bun installation wrappers are implemented in `scripts/run.sh` (macOS/Linux) and `scripts/run.ps1` (Windows).

### 8. Iterate
Ask the user if they want to:
- Refine the query (add filters, change aggregation)
- Change the time range
- Export results
- Run a follow-up query

## Truncated & Split Logs
When a log line is very long, two things can happen:

1. **Service-side truncation** — the service truncates the field before sending to Splunk. The truncation format varies by service (e.g. `Field=xyz (+12345 chars)`, `Field=xyz...`), so don't depend on a particular marker. The original content is lost; broaden your search terms or look for surrounding events.

2. **Splunk-side forced split** — if the service does *not* truncate, Splunk may force-split a single log line into two events. For example, an original log:
   ```
   Firm=XYZ User=JJ Message=<very long> ActivityId=asdf
   ```
   becomes two events:
   ```
   Firm=XYZ User=JJ Message=<beginning of the message
   <remaining part of the message> ActivityId=asdf
   ```
   A query like `Firm=XYZ ActivityId=asdf` will match **neither** event because no single event contains both fields.

If you expect a log to exist but can't find it, truncation or splitting may be the cause. Try relaxing or removing search criteria (e.g. search for just one key field at a time) to improve your chances of finding the split events, then correlate by timestamp or surrounding events.

## SPL Tips
- `| spath` auto-extracts all JSON fields from `_raw`
- `| spath path=nested.array{} output=item | mvexpand item | spath input=item` for nested arrays
- `| stats count by fieldName` for grouping
- `| timechart span=1h count` for time-series
- `| eval newField=if(condition, "yes", "no")` for computed fields
- `| where fieldName > 100` for filtering after extraction
- `| head 20` to limit results
- `| sort -fieldName` for descending sort
