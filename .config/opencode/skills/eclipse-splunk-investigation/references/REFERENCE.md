# Splunk REST API Reference (v6.x)

## Base URL
```
https://{SPLUNK_HOST}:8089
```
SSL verification may need to be disabled for internal/self-signed certs — the script handles this automatically.

## Authentication
HTTP Basic Auth using `SPLUNK_USERNAME` / `SPLUNK_PASSWORD` environment variables.

## Key Endpoints

### Create search job (async)
```
POST /services/search/jobs
Content-Type: application/x-www-form-urlencoded

search=search index=main sourcetype="kube:container:publisher-service" ERROR
earliest_time=-1h
latest_time=now
output_mode=json
```
Returns: `{ "sid": "1234567890.12345" }`

### Poll job status
```
GET /services/search/jobs/{sid}?output_mode=json
```
Check `entry[0].content.dispatchState` — done when `"DONE"`.
Also check `entry[0].content.resultCount` for how many results.

### Fetch results
```
GET /services/search/jobs/{sid}/results?output_mode=json&count=100&offset=0
```

### One-shot synchronous search (blocking, best for small result sets)
```
POST /services/search/jobs/export
search=search index=main ...
earliest_time=-1h
output_mode=json
```
Returns newline-delimited JSON events.

## SPL (Splunk Processing Language) Quick Reference

| Pattern | SPL |
|---|---|
| Errors for a service | `search index=main sourcetype="..." (ERROR OR Exception OR FATAL)` |
| Keyword search | `search index=main sourcetype="..." "some phrase"` |
| Field filter | `search index=main sourcetype="..." Level=ERROR` |
| Time window | `earliest=-4h latest=-1h` |
| Correlation ID | `search index=main (sourcetype="..." OR sourcetype="...") CorrelationId="abc-123"` |
| Slow ops (>5s) | `search index=main sourcetype="..." ElapsedTime>5000` |
| Event count by level | `search index=main sourcetype="..." \| stats count by Level` |
| Recent exception summary | `search index=main sourcetype="..." Exception \| stats count by ExceptionType` |

## Domain Log Format Notes (IBOR Example)

Many Eclipse domains use structured logging; IBOR services, for example, use `AccountingLogMessage`. Key fields in those log events:
- `Level` — DEBUG / INFO / WARN / ERROR
- `Message` — the log message text
- `OperationContext` — identifies the operation/request
- `CorrelationId` — links related logs across services
- `ElapsedTime` — milliseconds for workflow/activity timing (from `[ProfileWorkflow]`)
- `WorkflowName` / `ActivityName` — present for workflow profiling logs
- `ExceptionType` / `StackTrace` — present for ERROR events with exceptions
- `JobId` — for batch job processing logs

## Time Range Formats
Splunk accepts both relative and absolute times:
- Relative: `-15m`, `-1h`, `-24h`, `-7d`, `-30d@d`
- Absolute: `2024-01-15T10:00:00` or epoch seconds
- Special: `now`, `@d` (start of day), `@w` (start of week)

## Result Limits
- Default max events per search: 500,000 (Splunk default)
- Use `count` param on results endpoint to paginate (max 50000 per page)
- For large result sets, add `| head 1000` to SPL or use `count` parameter
