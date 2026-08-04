---
name: eclipse-splunk-investigation
description: >
  Investigates production behavior of Eclipse services by querying Splunk logs. Use this
  skill when asked to investigate production issues, errors, slow performance, job failures,
  or unexpected behavior in any Eclipse service. Works for both registry-backed services
  and arbitrary sourcetypes via --sourcetype or --raw-spl. Requires SPLUNK_HOST
  and SPLUNK_USERNAME environment variables, and either SPLUNK_PASSWORD stored in
  OS keyring or SPLUNK_TOKEN as an environment variable for authentication.
compatibility: >
  Requires Python 3.10+, the `requests` library, and the `keyring` library. Requires 
  network access to Splunk (default port 8089). Requires SPLUNK_HOST, SPLUNK_USERNAME 
  environment variables and SPLUNK_PASSWORD stored in OS keyring (or SPLUNK_TOKEN). 
  Targets Splunk Enterprise 6.x.
allowed-tools: bash
---

# Eclipse Splunk Log Investigation

This skill queries Splunk to investigate production behavior of Eclipse services.

---

## COMMON PITFALLS — Read This First

**Quick checklist before writing any SPL:**
1. Double-quote all dotted field names (e.g., `"k8s.pod.name"`)
2. Keep time windows narrow (`-2h` not `-7d`) to avoid timeouts
3. Search WARN + ERROR together for reliability incidents
4. Use `spath` for JSON extraction, `rex` only for unstructured text
5. Aggregate server-side (`stats`, `timechart`) instead of pulling raw events
6. Avoid leading wildcards (`*Timeout`) — use trailing wildcards or exact terms
7. Use `stats`, not `transaction`, for correlation
8. **Do NOT query TradeSrv / EMS logs unless the issue is specifically Eclipse ↔ EMS integration** (see pitfall #8 below)

### 1. Dotted field names MUST be double-quoted in SPL

Kubernetes metadata fields contain dots (e.g., `k8s.pod.name`). In SPL, dotted field names
**must** be wrapped in double quotes or the query silently returns zero results.

```
WRONG:  k8s.pod.name="my-pod"          (silently fails — zero results)
RIGHT:  "k8s.pod.name"="my-pod"        (works correctly)
```

This applies everywhere a dotted field is used — in `search`, `stats`, `eval`, `where`, etc.:
```spl
| stats count by "k8s.pod.name" "k8s.node.name"
| where "k8s.pod.name"="publisher-service-abc123"
```

Non-dotted fields like `host`, `sourcetype`, `Level`, `Message` do NOT need quotes.

### 2. Broad searches over long time ranges will timeout

The script has a 120-second poll timeout. Queries spanning 7+ days with broad text searches
will likely fail. Mitigations:
- Narrow the time window: use `--earliest "-2h"` instead of `--earliest "-7d"`
- Add specific filters: `sourcetype=`, `Level=`, `"k8s.pod.name"=`
- Use `| head N` or `--count` to limit results
- For trend analysis over long ranges, use `--stats` or `| timechart` to aggregate server-side

### 3. Log levels vary — check WARN, not just ERROR

Connection timeouts, transient failures, and degraded-state events are often logged as
`Level=WARN`, not `Level=ERROR`. When investigating issues, search for both:
```bash
python3 scripts/splunk_query.py --service publisher --search 'Level=WARN OR Level=ERROR' --earliest -2h
```
Or search by keyword without a level filter to avoid missing relevant events.

### 4. Extracting fields from JSON — use `spath`, not `rex`

Many Eclipse services emit structured JSON logs. Use **`spath`** (targeted) to extract JSON fields —
it handles nesting, escaping, and arrays natively. Only fall back to `rex` for truly
unstructured text (e.g. key=value pairs inside a freeform Message string).

```spl
# PREFERRED — spath for JSON field extraction
| spath path="Database" output=db
| spath path="Server" output=server
| spath path="error.message" output=err_msg

# WRONG — rex on JSON is fragile and breaks on escaped quotes / nested objects
| rex field=_raw "\"Database\":\"(?<db>[^\"]+)\""
```

**When to use `rex` instead:** Only when the data is genuinely unstructured text, not JSON:
```spl
# rex is correct here — extracting from a freeform log line
| rex field=Message "elapsed=(?<elapsed_ms>\d+)ms"
| rex field=Message "userId=(?<user_id>\w+)"
```

**Never use bare `| spath`** (no path argument) on large result sets — it extracts every
field from every event and is extremely expensive. Always extract specific paths.

### 5. Large result sets — aggregate, don't pull raw events

When analyzing patterns over time, results can easily exceed 200-500 rows. Prefer
server-side aggregation:
```spl
| stats count by "k8s.pod.name" "k8s.node.name"
| eval hour=strftime(_time, "%Y-%m-%d %H:00") | stats count by hour
| bin _time span=1m | stats count by _time
| timechart span=5m count by Level
```

### 6. Leading wildcards disable index optimization

Splunk's term index is a prefix tree. Trailing wildcards (`Exception*`) can use bloom filters;
leading wildcards (`*Exception`) force a full scan of every event.

```spl
# BAD — leading wildcard, full scan
index=main sourcetype="kube:container:publisher-service" *Timeout*

# GOOD — trailing wildcard or exact match
index=main sourcetype="kube:container:publisher-service" Timeout*
index=main sourcetype="kube:container:publisher-service" "SqlTimeoutException"
```

### 7. Use `stats`, not `transaction`, for correlation

`transaction` is memory-intensive and does not scale. For tracing requests or jobs across
services, use `stats`-based correlation on `CorrelationId` or `JobId`:

```spl
# BAD — transaction is very expensive on high-volume log streams
index=main CorrelationId="req-abc-123" | transaction CorrelationId

# GOOD — stats-based correlation
index=main CorrelationId="req-abc-123"
| stats min(_time) as first_event, max(_time) as last_event,
        values(sourcetype) as services, count as event_count,
        list(Level) as levels
  by CorrelationId
| eval duration_sec = round(last_event - first_event, 1)
```

### 8. TradeSrv and EMS logs are NOT Eclipse logs — do not query them unless investigating Eclipse ↔ EMS integration

The following sourcetypes in `index=main` belong to the **EMS product** (a separate order management/execution system), not to Eclipse:

| Sourcetype pattern | What it is |
|---|---|
| `TradeSrv`, `TradeSrv-N` | EMS application (trade server) logs |
| `ENG-*` (e.g. `ENG-EMSX-NOE-2`, `ENG-FIXLINK-FE-4`) | FIX engine / EMS order routing logs |
| `TR-*` (e.g. `TR-FIXLINK-FEHost-2`, `TR-NYFIX-FEHost-3`) | EMS trade routing host logs |

These logs contain order and FIX message data that may superficially look relevant during Eclipse trading investigations, but they are from a **separate system** and are almost always a red herring for Eclipse-side issues.

**Only query these sourcetypes when the issue is explicitly about Eclipse ↔ EMS integration**, such as:
- FIX messages not being sent out from Eclipse to the EMS
- Fills not flowing back from EMS into Eclipse
- Route configurations not taking effect
- Orders stuck in a state that requires EMS acknowledgment

**For Eclipse-side trading issues** (order tickets, blotter, allocations, etc.), use Eclipse's own services:
- `trading-ems-connector` (`index=docker`) — the Eclipse-side bridge to EMS; start here for integration triage
- `trading-hercules-engine` / `trading-hercules-api` (`index=docker`) — Eclipse order processing (Rancher 1.6, not EKS)
- `internal-api-gateway` (`index=main`) — Eclipse HTTP API layer (for session and request-level issues)

---

## Common Kubernetes Fields

These fields commonly appear in Eclipse Kubernetes service logs:

| Field | Dotted? | Notes |
|---|---|---|
| `"k8s.pod.name"` | Yes — must double-quote | Pod name |
| `"k8s.node.name"` | Yes — must double-quote | Node name |
| `host` | No | Node hostname (full FQDN); supports wildcards: `host="ip-10-114-246-211*"` |
| `sourcetype` | No | e.g., `kube:container:publisher-service` |
| `Type` | No | .NET logger type name |
| `Level` | No | Log level: `DEBUG`, `INFO`, `WARN`, `ERROR` |

---

## Useful SPL Patterns

### Aggregation and grouping
```spl
# Group events by pod and node
| stats count by "k8s.pod.name" "k8s.node.name"

# Hourly event counts
| eval hour=strftime(_time, "%Y-%m-%d %H:00") | stats count by hour

# Per-minute bucketing
| bin _time span=1m | stats count by _time

# Timechart for visualizing trends
| timechart span=5m count by Level
```

### Field extraction
```spl
# Extract JSON fields with spath (preferred for structured domain logs)
| spath path="Database" output=db
| spath path="Server" output=server
| stats count by server

# Extract from unstructured text with rex (freeform Message strings only)
| rex field=Message "elapsed=(?<elapsed_ms>\d+)ms"
| rex field=Message "userId=(?<user_id>\w+)"
```

### Distinct values and discovery
```spl
# Count distinct values of a field
| stats dc("k8s.pod.name") as unique_pods

# List all values of a field
| stats values("k8s.pod.name") as pods

# Discover what types/categories exist
| stats count by Type | sort -count | head 20
```

---

## Performance Tips

1. **Filter left, transform right** — SPL is processed left to right. Push the most restrictive filters as far left as possible. `index=` and `sourcetype=` use bloom filters (virtually free); text matches and field filters come next; `eval`/`spath`/`rex` should come after filtering.
   ```spl
   # GOOD — filters narrow before extraction
   index=main sourcetype="kube:container:publisher-service" Level=ERROR "Timeout"
   | spath path="Database" output=db
   | stats count by db

   # BAD — extraction happens on every event, then filtered
   index=main sourcetype="kube:container:publisher-service"
   | spath path="Database" output=db
   | search Level=ERROR
   ```
2. **Always specify `index=` and `sourcetype=`** — never rely on defaults or use `index=*`
3. **Narrow time windows** — `--earliest "-2h"` instead of `--earliest "-7d"` whenever possible
4. **Limit results** — use `| head N` in SPL or `--count N` on the script
5. **Aggregate server-side** — `stats`, `timechart`, `bin` reduce data transferred
6. **Use targeted `spath`** — always extract specific paths, never bare `| spath`
7. **Choose `timechart span` based on your time window**:
   | Time window | Recommended span |
   |---|---|
   | Last 30 min | `span=1m` |
   | Last 1-2 hours | `span=5m` |
   | Last 5 hours | `span=15m` |
   | Last 24 hours | `span=1h` |
   | Last 7 days | `span=4h` |

---

## ⚠️ Core Principle: Schema Discovery Protocol

**NEVER guess or assume field names, especially regarding case sensitivity.**

Splunk field names are case-sensitive. A query using `level=ERROR` will silently return zero results if the actual field is `Level`. Before writing any analytical query, you MUST use `scripts/splunk_explorer.py` to discover the exact schema.

### Mandatory steps before any new query

1. **Confirm the index exists**
   ```bash
   cd ~/.copilot/skills/eclipse-splunk-investigation
   python3 scripts/splunk_explorer.py --mode list_indexes --pretty
   ```

2. **Confirm the exact sourcetype string**
   ```bash
   python3 scripts/splunk_explorer.py --mode list_sourcetypes --index main --pretty
   ```

3. **Extract the exact field names (with correct casing)**
   ```bash
   python3 scripts/splunk_explorer.py --mode list_fields \
     --index main \
     --sourcetype "kube:container:peprocessor-service" \
     --pretty
   ```
   Inspect the returned field list carefully before referencing any field in `splunk_query.py`.

### Rules
- **Never** use a field name without first confirming it from `list_fields` output.
- **Never** assume a field is `Level` — it could be `level`, `log_level`, `Severity`, etc. Always verify.
- **Never** assume a sourcetype string — always use `list_sourcetypes` or the registry in `assets/services.json`.
- If `list_fields` returns an empty array, widen the time window (`--earliest` defaults to `-7d` in the explorer).
- Cache the discovered schema mentally for the current session; re-run discovery if investigating a different service or index.

---

## Service Registry

Service-to-sourcetype mappings are maintained in `assets/services.json`. The canonical service names and their Splunk targets are:

| Service Name  | Index   | Sourcetype                              | Aliases                      |
|---------------|---------|-----------------------------------------|------------------------------|
| `publisher`   | `main`  | `kube:container:publisher-service`      | publisher-service, pub       |
| `peprocessor` | `main`  | `kube:container:peprocessor-service`    | pe-processor, pep            |
| `valuation`   | `main`  | `kube:container:valuation-service`      | valuation-service, val       |
| `router`      | `main`  | `kube:container:router-service`         | router-service               |
| `ims-eos`     | `docker`| `ims-eos`                               | eos, imseos                  |
| `ims-eos-postgres` | `docker` | `ims-eos-postgres`               | eos-postgres, imseos-postgres |

Index guidance:
- Kubernetes service logs are typically in `index=main`.
- Rancher 1.6 service logs are typically in `index=docker`.

To add a new service, edit `assets/services.json` and add an entry following the existing pattern.
For services not yet in the registry, use `--sourcetype <exact-type>` directly.

## Error Handling

If Splunk is unreachable or credentials are invalid, the scripts will return an error message. Handle these scenarios as follows:

- **Connection refused / timeout**: Verify `SPLUNK_HOST` is correct and that you have network access to port 8089. Check VPN connectivity if applicable.
- **HTTP 401 Unauthorized**: Credentials are invalid. Re-run the setup script to update them, or verify your `SPLUNK_TOKEN` is current. If the script output includes an absolute `setup.py` path, give that exact path to the user instead of shortening it to `python3 scripts/setup.py`.
- **Keyring entry not found**: `SPLUNK_PASSWORD` is missing from the OS keyring. The loader prints the active skill root and the absolute `setup.py` path programmatically. Surface those exact paths to the user instead of making them guess where the skill was loaded from.
- **SSL errors**: The Splunk endpoint may require a specific CA bundle. Set `REQUESTS_CA_BUNDLE` if needed.

Always resolve credential/connectivity issues before re-running queries.

## Prerequisites

### Installing Dependencies

```bash
pip install requests keyring
```

### Configuring Credentials

The skill uses a flexible configuration system that supports multiple sources:

**Configuration Priority** (highest to lowest):
1. **Environment variables** - Allows runtime override
2. **`.env` file** - For SPLUNK_HOST and SPLUNK_USERNAME
3. **OS Keyring** - For SPLUNK_PASSWORD (secure storage)

**Quick Setup** (one command):

```bash
python3 scripts/setup.py
```

The install location can vary by environment. When the loader reports a missing keyring entry, it prints the exact active skill root and an absolute path to `setup.py`; prefer those programmatically generated paths when instructing the user.

This interactive script will:
1. Prompt for SPLUNK_HOST (defaults to `splunk-awsprod.ezesoft.net`)
2. Prompt for SPLUNK_USERNAME
3. Securely prompt for SPLUNK_PASSWORD
4. Store the password in your OS keyring (secure)
5. Create a `.env` file with host and username

**Non-interactive setup** (for automation):

```bash
python3 scripts/setup.py \
  --host splunk-awsprod.ezesoft.net \
  --username your-username \
  --password your-password
```

**Alternative: Manual setup**

If you prefer, you can manually configure:
- Copy `.env.example` to `.env` and edit it
- Store password in keyring: `python -c "import keyring; keyring.set_password('eclipse-splunk-investigation', 'SPLUNK_PASSWORD', 'your-password')"`

If a query says the keyring entry is missing, that means `SPLUNK_PASSWORD` was not found in the OS keyring under:
- service: `eclipse-splunk-investigation`
- username: `SPLUNK_PASSWORD`

Fix it by running:

```bash
python3 scripts/setup.py
```

Or store just the password manually:

```bash
python3 -c "import keyring; keyring.set_password('eclipse-splunk-investigation', 'SPLUNK_PASSWORD', 'your-password')"
```

**Configuration variables:**

| Variable | Description | Recommended Source |
|---|---|---|
| `SPLUNK_HOST` | Splunk hostname, e.g. `splunk.internal` or `splunk.internal:8089`. `https://` prefix is stripped automatically. | `.env` file or shell profile |
| `SPLUNK_USERNAME` | Splunk username | `.env` file or shell profile |
| `SPLUNK_PASSWORD` | Splunk password | OS keyring (via configure script) |
| `SPLUNK_TOKEN` | Bearer token (optional, takes precedence over username/password if set) | Environment variable |

**Configuration Loading Order:**
1. Environment variables checked first (always wins if set)
2. `.env` file loaded for SPLUNK_HOST and SPLUNK_USERNAME
3. Keyring loaded for SPLUNK_PASSWORD
4. `.env` file fallback for SPLUNK_PASSWORD (deprecated, shows warning)

## Schema Discovery Script (`splunk_explorer.py`)

Use `scripts/splunk_explorer.py` to discover the exact schema before querying.
Requires `requests` (`pip install requests`). Output is a JSON array to stdout; diagnostics go to stderr.

### Mode: `list_indexes` — discover available indexes
```bash
cd ~/.copilot/skills/eclipse-splunk-investigation
python3 scripts/splunk_explorer.py --mode list_indexes --pretty
```
Returns a sorted JSON array of non-internal index names, e.g.:
```json
["main", "history", "summary"]
```

### Mode: `list_sourcetypes` — discover sourcetypes within an index
```bash
python3 scripts/splunk_explorer.py --mode list_sourcetypes --index main --pretty
```
Returns a sorted JSON array of sourcetype strings found in that index, e.g.:
```json
[
  "kube:container:peprocessor-service",
  "kube:container:publisher-service",
  "kube:container:valuation-service"
]
```

### Mode: `list_fields` — discover exact field names for a sourcetype
```bash
python3 scripts/splunk_explorer.py \
  --mode list_fields \
  --index main \
  --sourcetype "kube:container:peprocessor-service" \
  --pretty
```
Returns a sorted JSON array of field names with exact casing, e.g.:
```json
["ActivityName", "CorrelationId", "ElapsedTime", "ExceptionType", "JobId", "Level", "Message", "OperationContext", "WorkflowName", "_raw", "_time", "host", "sourcetype"]
```
Use these exact names in `splunk_query.py` — e.g. `--level ERROR` filters on `Level`, which the script above confirmed is `Level` not `level`.

## How to Run Analytical Queries

Use `scripts/splunk_query.py` after completing schema discovery. The script uses only the Python standard library — no extra `pip install` needed.

```bash
python3 scripts/splunk_query.py [OPTIONS]
```

For full option reference, run:
```bash
python3 scripts/splunk_query.py --help
```

### Time range formats

The `--earliest` and `--latest` flags accept these formats:

| Format | Example | Description |
|---|---|---|
| Relative | `--earliest "-1h"` | 1 hour ago (quotes needed for negative values) |
| Relative | `--earliest "-30m"` | 30 minutes ago |
| Relative | `--earliest "-7d"` | 7 days ago (may timeout for broad queries) |
| Snap-to | `--earliest "-1d@d"` | Start of yesterday |
| Absolute ISO | `--earliest "2026-04-09T16:00:00"` | Specific timestamp |
| Absolute epoch | `--earliest "1712678400"` | Unix epoch seconds |
| Special | `--latest "now"` | Current time (default for --latest) |

**Important:** Always quote relative times that start with a dash (e.g., `--earliest "-2h"`)
to prevent the shell from interpreting them as flags.

### Output format: `--format json` for field discovery

Use `--format json` to see the complete event structure with all fields. This is essential
for discovering field names, understanding the event schema, and debugging queries:

```bash
python3 scripts/splunk_query.py --service publisher --earliest "-15m" --count 3 --format json
```

This outputs the full JSON representation of each event, showing all available fields
and their exact names/casing. Use this when:
- You need to discover what fields exist in events
- You want to understand the structure of `Message` or `_raw` fields
- Your table-format query returns unexpected results and you need to debug

## Common Investigation Workflows

### 0. Incident intake checklist (use before querying)
When the user reports an incident, capture these first:
- suspected `index` (for example `main` for Kubernetes workloads, `docker` for Rancher 1.6 workloads)
- one or more `sourcetype` values
- time window (`earliest` and `latest`)
- symptom keywords (for example `authentication failed`, `timeout`, `vault`)

If index or sourcetype is unknown, run schema discovery first:
```bash
python3 scripts/splunk_explorer.py --mode list_sourcetypes --index docker --pretty
python3 scripts/splunk_explorer.py --mode list_fields --index docker --sourcetype "ims-eos" --pretty
```

### 1. Recent errors for a service
```bash
python3 scripts/splunk_query.py --service publisher --level ERROR --earliest -1h
```

### 1b. Start with WARN + ERROR together for reliability incidents
```bash
python3 scripts/splunk_query.py --sourcetype "ims-eos" --index docker --search 'Level=WARN OR Level=ERROR' --earliest -4h
```

### 2. Investigate a specific exception type across all services
```bash
python3 scripts/splunk_query.py --service all --keyword "NullReferenceException" --earliest -4h
```

### 3. Track a batch job by ID across all services
```bash
python3 scripts/splunk_query.py --service all --job-id "abc-123-xyz" --earliest -24h --count 200
```

### 4. Follow a request by correlation ID
```bash
python3 scripts/splunk_query.py --service all --correlation-id "req-abc-456" --earliest -6h
```

### 5. Error count summary by level for a service
```bash
python3 scripts/splunk_query.py --service peprocessor --stats Level --earliest -24h
```

### 5b. Investigate a non-registry service by explicit sourcetype
```bash
python3 scripts/splunk_query.py --sourcetype "ims-eos" --index docker --level ERROR --earliest -2h
```

### 5c. Investigate app + sidecar together (same index)
```bash
python3 scripts/splunk_query.py --sourcetype "ims-eos" --sourcetype "ims-eos-postgres" --index docker --earliest -2h
```

### 6. Error summary across all services (good for daily health check)
```bash
python3 scripts/splunk_query.py --service all --level ERROR --stats sourcetype --earliest -24h
```

### 7. Slow workflow/activity detection
```bash
python3 scripts/splunk_query.py --service valuation --search "ElapsedTime>5000" --earliest -2h
```

### 8. Recent activity for a service (last 30 min, INFO and above)
```bash
python3 scripts/splunk_query.py --service router --level INFO --earliest -30m
```

### 9. Custom SPL for advanced investigation
```bash
python3 scripts/splunk_query.py --raw-spl \
  'search index=main sourcetype="kube:container:peprocessor-service" ERROR | stats count by ExceptionType | sort -count'
```

### 10. Output as JSON for further processing
```bash
python3 scripts/splunk_query.py --service valuation --level ERROR --format json --earliest -4h
```

### 11. Onset detection around a maintenance window
```bash
python3 scripts/splunk_query.py --raw-spl \
  'search index=docker sourcetype="ims-eos" "password authentication failed" earliest="04/10/2026:20:00:00" latest="04/11/2026:02:00:00" | timechart span=10m count'
```

### 12. Verify recovery after restart
```bash
python3 scripts/splunk_query.py --raw-spl \
  'search index=docker sourcetype="ims-eos" earliest=-15m | stats count by Level'
python3 scripts/splunk_query.py --raw-spl \
  'search index=docker sourcetype="ims-eos-postgres" FATAL earliest=-15m | stats count'
```

## Domain-Specific Investigation Patterns (IBOR Examples)

These patterns address common Eclipse accounting scenarios that go beyond basic log queries.
Use them as templates and adapt field names / sourcetypes for other services.

### Batch job lifecycle — trace a Router-initiated job end to end
```bash
# See all events for a job across all IBOR services
python3 scripts/splunk_query.py --service all --job-id "abc-123-xyz" --earliest -24h --count 500
```
```spl
# Stats-based summary: which services processed this job, how long, any errors?
index=main JobId="abc-123-xyz"
| stats min(_time) as job_start, max(_time) as job_end,
        values(sourcetype) as services_touched,
        sum(eval(if(Level="ERROR",1,0))) as error_count,
        values(eval(if(Level="ERROR", Message, null()))) as error_messages
  by JobId
| eval duration_sec = round(job_end - job_start, 1)
```

### Cross-service error propagation — find failures that cascade
```spl
# Find correlation IDs that have errors in more than one IBOR service
index=main Level=ERROR CorrelationId=*
  (sourcetype="kube:container:publisher-service"
   OR sourcetype="kube:container:peprocessor-service"
   OR sourcetype="kube:container:valuation-service"
   OR sourcetype="kube:container:router-service")
| stats values(sourcetype) as error_services, dc(sourcetype) as service_count,
        values(ExceptionType) as exceptions, earliest(_time) as first_error
  by CorrelationId
| where service_count > 1
| sort first_error
```

### Error burst detection — find sudden spikes
```spl
# Find 1-minute windows where errors exceed 3 standard deviations above the mean
index=main sourcetype="kube:container:publisher-service" Level=ERROR
| bin _time span=1m
| stats count by _time
| eventstats avg(count) as avg_errors, stdev(count) as stdev_errors
| where count > (avg_errors + 3 * stdev_errors)
| sort -count
```

### Slow workflow analysis — find bottleneck activities
```spl
# Identify the slowest workflow steps across a service
index=main sourcetype="kube:container:peprocessor-service" ElapsedTime=*
| stats avg(ElapsedTime) as avg_ms, max(ElapsedTime) as max_ms,
        perc95(ElapsedTime) as p95_ms, count
  by WorkflowName ActivityName
| where p95_ms > 1000
| sort -p95_ms
```

### Pod restart correlation — did errors coincide with restarts?
```spl
# Find pod start events and overlay with error timeline
index=main sourcetype="kube:container:publisher-service"
  ("Application started" OR "Hosting started" OR "Now listening")
| stats earliest(_time) as start_time by "k8s.pod.name"
| sort start_time
```

### Error rate as percentage of total traffic
```spl
index=main sourcetype="kube:container:publisher-service"
| stats count as total,
        sum(eval(if(Level="ERROR",1,0))) as errors,
        sum(eval(if(Level="WARN",1,0))) as warnings
| eval error_rate_pct = round(errors/total*100, 2)
| eval warn_rate_pct = round(warnings/total*100, 2)
```

## Interpreting Domain Log Events (IBOR Example)

Some Eclipse domains (including IBOR) use structured logging via `AccountingLogMessage`. Key fields (confirmed via `list_fields`):

- **`Level`** — DEBUG / INFO / WARN / ERROR
- **`Message`** — Human-readable description of the event
- **`OperationContext`** — Identifies the API operation or workflow step
- **`CorrelationId`** — Links related log entries across services for a single business request
- **`JobId`** — Present on batch processing log entries; links to Router-initiated jobs
- **`ElapsedTime`** — Milliseconds elapsed (from `[ProfileWorkflow]` instrumentation)
- **`WorkflowName`** / **`ActivityName`** — Workflow engine profiling entries
- **`ExceptionType`** / **`StackTrace`** — Present on ERROR entries with exceptions

### Typical investigation steps

1. **Discover schema** using `splunk_explorer.py` (mandatory — see Schema Discovery Protocol above)
2. **Start broad**: query `--level ERROR` for the suspected service/time window
3. **Find correlation IDs**: from error events, extract `CorrelationId` values
4. **Trace the full flow**: re-query `--correlation-id <id> --service all` to see the cross-service path
5. **Check timing**: look for `ElapsedTime` values to identify slow steps
6. **Summarise**: use `--stats` to aggregate counts for a higher-level picture

## Detailed Reference

See [references/REFERENCE.md](references/REFERENCE.md) for:
- Full Splunk 6.x REST API endpoint reference
- SPL query examples
- Time range format guide
- Result pagination details
