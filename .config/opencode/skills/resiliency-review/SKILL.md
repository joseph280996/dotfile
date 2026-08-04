---
name: resiliency-review
description: >
  Performs a comprehensive resiliency review of a microservice by analyzing its codebase.
  Discovers all dependencies, maps every workflow's dependency interactions, identifies
  failure modes, and surfaces inconsistencies in timeout/retry/error-handling patterns.
  Use when asked to review resiliency, analyze failure modes, audit dependency patterns,
  check service reliability, or produce a resiliency document for any microservice.
license: Proprietary
metadata:
  author: "@rblandford"
  version: "1.0.1"
  tags: "resiliency,reliability,review,microservice,failure-modes"
  scope-roles: "dev"
compatibility: >
  Works with any microservice codebase accessible in the workspace (C#/.NET, Java/Spring,
  Go, Node.js/TypeScript, Python, Rust, etc.). Requires read access to source code.
   No external tools or credentials needed by default — analyze source plus repo-resident
   operational configuration first. Runtime validation may still be required for effective
   values and live behavior.
allowed-tools: read_file, grep_search, file_search, list_dir, semantic_search, runSubagent
---

# Service Resiliency Review

Produces a comprehensive resiliency review document for a target microservice by performing static code analysis across all dependency interactions.

---

## Invocation

The user will ask something like:
- "Run a resiliency review on [service]"
- "Analyze the failure modes of [service]"
- "Review the resiliency of [service]"
- "What happens when [service]'s dependencies fail?"

If the user does not specify a target service or the workspace contains multiple services, ask which service to analyze.

---

## Output

A single markdown document placed at `docs/resiliency-review.md` in the target service's root, structured per the Output Format below and starting with a short prioritized risk summary.

---

## Output Format

### Executive Summary

Start with a short, prioritized summary table of the highest-risk findings so the document is actionable without reading every workflow table.

| Risk | Severity | Blast Radius | Why It Matters | Recommended Action | Evidence |
|------|----------|--------------|----------------|--------------------|----------|

### 1. Overview

Brief description of the service's role, its entry points (HTTP controllers, message consumers, scheduled jobs, background workers), and key operational characteristics.

### 2. Dependency Inventory

| # | Dependency | Type | Communication Method | Purpose |
|---|-----------|------|---------------------|---------|
| 1 | Example DB | Database | ADO.NET / EF Core | Persistence |
| 2 | Example Cache | Infrastructure | TCP | Caching / deduplication |
| 3 | Example Service | Service | HTTP | Data enrichment |

### 3. Workflow Analysis

Per workflow, use a dependency interaction table with one row per external or persistence interaction:

| Step | Name | Dependency | Direction | Endpoint / Topic | Data & Purpose | Resiliency | Timeout | On Failure | Evidence | Confidence | Action Items |
|------|------|-----------|-----------|-----------------|----------------|------------|---------|------------|----------|------------|--------------|

**Column definitions:**
- **Step**: Sequence number within the workflow
- **Name**: Human-readable name for this interaction
- **Dependency**: Which service/infra is being called
- **Direction**: HTTP GET/POST/PUT, RMQ publish/consume, DB read/write, TCP etc.
- **Endpoint / Topic**: Exact URL pattern, stored procedure name, queue/topic name
- **Data & Purpose**: What payload is sent, what response is expected, and HOW the response is used by subsequent steps. For GETs: what data is being fetched and what decisions depend on it.
- **Resiliency**: Retry count, backoff strategy, circuit breaker, which errors trigger retry. Include config key names, defaults, and source file references.
- **Timeout**: Per-attempt and overall timeout values with source (config key or hardcoded constant with file reference)
- **On Failure**: What happens for EACH failure mode: transient (5xx/timeout), permanent (4xx), unavailable (network). Include fallback/default values. Include whether processing continues or halts.
- **Evidence**: One or more concrete file references showing the implementation and config source for this row.
- **Confidence**: One of `✅ Verified from code`, `⚠️ Inferred from context`, or `❓ Unknown / needs verification`.
- **Action Items**: Gaps and recommendations INLINE with [TBD] JIRA placeholder. Empty if no issues. Include **[DISCREPANCY]** tags for consistency issues found in Phase 3.

**Structure per workflow:**
- Brief prose description of the workflow **before** the table (what it does, when it runs, key context)
- The table (one row per dependency interaction step)
- If a workflow has too many steps for one readable table, split it into multiple tables such as `Primary Path`, `Async Continuations`, or `Failure Handling`, but keep step numbering consistent.
- No post-table sections — all information lives in the pre-table description or inline in the table cells
- No separate "Configuration" section — config values (keys, defaults, source file) are included inline in the relevant table cells (Resiliency, Timeout columns)

### 4. Consistency Analysis

A rigorous cross-cutting analysis comparing implementation patterns across ALL dependency interactions. Surfaces discrepancies with **[DISCREPANCY]** tags and questions for the team.

#### 4.1 Timeout Consistency

| Dependency | Per-Try Timeout | Overall Timeout | Source | Justification |
|-----------|----------------|-----------------|--------|---------------|

**Questions to surface:**
- Are timeout values proportional to expected operation latency? (Cache read ≠ complex DB write.)
- Does the overall timeout exceed upstream caller timeouts? (Wasted work if caller gives up first.)
- Are there dependencies with NO explicit timeout? (System defaults like HttpClient 100s are almost always bugs.)
- Do child workflow timeouts fit within parent workflow timeouts? (Sum of worst-case sequential calls must fit.)

#### 4.2 Retry Consistency

| Dependency | Retry Count | Backoff Strategy | Retryable Conditions | Source | Justification |
|-----------|-------------|------------------|---------------------|--------|---------------|

**Questions to surface:**
- Are retry counts consistent for dependencies of similar criticality?
- Is the backoff strategy appropriate? (Immediate retry on rate-limited API is harmful.)
- Are retryable conditions correctly identified? (Retrying 400 = bug. Not retrying 429 = gap.)
- Is there a circuit breaker for high-retry dependencies?
- Do retry policies account for idempotency?

#### 4.3 Error Handling Consistency

| Dependency | On Transient Failure | On Permanent Failure | On Network Unavailable | Processing Halts? | Source |
|-----------|---------------------|---------------------|----------------------|-------------------|--------|

**Questions to surface:**
- Are there swallowed exceptions? For each: what data is lost, who detects it, what's the recovery?
- Are there failures that halt workflows that probably shouldn't? (Audit write stopping order processing.)
- Are there failures that don't halt workflows that probably should? (Compliance check being skipped.)
- Is error propagation consistent? (One client throws on 5xx, another returns null — callers handle differently.)

#### 4.4 Observability Consistency

| Dependency | Logged on Success? | Logged on Failure? | Metrics/Alerts? | Correlation ID Propagated? | Source |
|-----------|-------------------|-------------------|----------------|---------------------------|--------|

**Questions to surface:**
- Can operators detect dependency degradation? (Swallowed failures without metrics = invisible.)
- Is there sufficient context in failure logs for diagnosis? (Endpoint, response code, elapsed time, correlation ID.)
- Are there dependencies with no failure logging?

#### 4.5 Data Integrity Consistency

| Dependency | Idempotent? | Compensating Action on Failure? | Partial State Possible? | Source |
|-----------|-------------|-------------------------------|------------------------|--------|

**Questions to surface:**
- Are there multi-step workflows where Step N succeeds but Step N+1 fails, leaving inconsistent state?
- Are retried operations idempotent? If not, what prevents duplicates?
- Can the service recover to consistent state after crash at any workflow point?

#### 4.6 Criticality vs. Protection Mismatch

| Dependency | Business Criticality | Protection Level (Retry + Timeout + CB) | Mismatch? |
|-----------|---------------------|---------------------------------------------|-----------|

**Questions to surface:**
- Are the most critical dependencies the most protected?
- Are non-critical dependencies over-protected, adding latency on the critical path?
- Are there blast-radius concerns? (Non-critical dependency with no timeout starving critical operations.)
#### 4.7 Caching Appropriateness

| Dependency | Data Volatility | Call Frequency | Currently Cached? | Cache TTL | Source | Recommendation |
|-----------|----------------|----------------|-------------------|-----------|--------|----------------|

**Questions to surface:**
- Are there high-frequency calls for data that rarely changes? (Reference data, configuration, security master data, holiday calendars, FX rates.) These should be cached with appropriate TTL.
- Are there calls made per-request for data that could be cached per-session, per-minute, or per-day? Flag with **[DISCREPANCY: cacheable data fetched on every call]**.
- Are cached values invalidated correctly? Could stale cache entries cause incorrect business decisions?
- Are there calls inside loops or batch operations that could be batched or pre-fetched instead?
- Is there a cache stampede risk? (Many concurrent requests for the same expired key hitting the backing service simultaneously.)
- Are there dependencies where caching is applied but the TTL is inappropriate? (Too short = no benefit. Too long = stale data risk.)
- For data used in financial calculations: is the staleness window acceptable for the business decision being made?

#### 5 Capacity & Backpressure

| Dependency / Resource | Concurrency / Pool Limit | Backpressure / Bulkhead | Overload Behavior | Source | Recommendation |
|-----------------------|--------------------------|-------------------------|-------------------|--------|----------------|

**Questions to surface:**
- Are queue consumers, worker pools, DB connection pools, and HTTP connection limits explicitly bounded?
- Can retries amplify load across layers? (Caller retries while callee also retries or queues backlog.)
- Are there bulkheads or isolation boundaries preventing one degraded dependency from starving unrelated work?
- Is overload behavior explicit? (Reject, shed, queue, block, dead-letter, or crash.)
- Are high-cardinality fan-out or per-item calls performed without batching, throttling, or concurrency limits?

#### 4.9 Startup, Readiness & Shutdown

| Lifecycle Path | Dependency Touches | Failure Behavior | Traffic Gated by Readiness? | Graceful Shutdown / Drain? | Source |
|----------------|--------------------|------------------|-----------------------------|----------------------------|--------|

**Questions to surface:**
- Which dependencies are required at startup versus optional after boot?
- Can liveness/readiness configuration cause crash loops or route traffic to an unready instance?
- During shutdown or deploy, can in-flight work be lost because consumers, background workers, or HTTP requests are not drained cleanly?
- After restart, can the service safely resume, replay, or reconcile partial work?

#### 4.10 Effective Configuration Resolution

| Setting | Code Default | Config Key / Name | Override Sources | Effective Value | Verified? | Source |
|---------|--------------|-------------------|------------------|-----------------|-----------|--------|

**Questions to surface:**
- Is the effective timeout/retry/concurrency value actually determinable from the repo, or only the declared default?
- Are environment-specific overrides likely to change resiliency behavior materially?
- Are there conflicting defaults across code, config files, env templates, or deployment manifests?
- When the effective value cannot be proven, is the uncertainty made explicit rather than treated as fact?

#### 4.11 Cancellation Token Propagation

| Workflow / Method | Accepts Token? | Passes to Outbound Calls? | Respects on Inbound Endpoints? | Wasted Work Risk | Source | Recommendation |
|-------------------|----------------|---------------------------|-------------------------------|------------------|--------|----------------|

**Questions to surface:**
- Are cancellation tokens accepted at every entry point (controller actions, message handlers, background tasks) and threaded through to all outbound dependency calls (HTTP, DB, cache, queue publish)?
- When a caller times out and retries, does the abandoned request continue executing downstream work? If so, flag as **[DISCREPANCY: wasted work on abandoned request]**.
- Are long-running operations (batch loops, streaming reads, large queries) checking the cancellation token periodically, or do they run to completion regardless?
- Are cancellation tokens linked to request-scoped timeouts so that when the configured timeout expires, downstream work is cancelled automatically?
- For fire-and-forget or queued work: is it appropriate to NOT propagate cancellation (because the work must complete independently), and is that decision explicit?
- Are there methods that accept a `CancellationToken` parameter but never pass it to the async calls they make? Flag as **[DISCREPANCY: token accepted but not propagated]**.
- Are there methods that default the token to `CancellationToken.None` or equivalent, silently opting out of cancellation without justification?
- When cancellation is observed (e.g., `OperationCanceledException`), is cleanup performed correctly (partial writes rolled back, resources released, metrics recorded)?

### 5. Unknowns / Requires Verification

Checklist of items that cannot be determined from code alone and require infrastructure verification, runtime observation, or team input.

---

## Execution Plan

### Phase 1: Dependency Discovery

Perform a **thorough code-level analysis** of the target service using the Explore sub-agent. Adapt search terms to the service's language/framework:

1. **Identify all outbound HTTP clients** — search for:
   - .NET: `HttpClient`, `IHttpClientFactory`, Polly policies, `RestClient`
   - Java/Spring: `RestTemplate`, `WebClient`, `Feign`, `OkHttpClient`, Resilience4j
   - Go: `http.Client`, `net/http`, circuit breaker libs (e.g., `gobreaker`, `hystrix-go`)
   - Node.js: `axios`, `fetch`, `got`, `node-fetch`, `undici`
   - Python: `requests`, `httpx`, `aiohttp`, `urllib3`
   - Any language: base URLs, route constants, retry/backoff configuration
2. **Identify all message queue interactions** — search for RabbitMQ/RMQ/Kafka/SQS/NATS/Redis Streams publishers, consumers, topic/queue names
3. **Identify all database interactions** — search for ORM contexts, connection strings/pools, stored procedure calls, DAL/repository layers, raw SQL, query builders
4. **Identify all cache interactions** — search for Redis, Memcached, in-memory/local caches, CDN cache headers, memoization patterns
5. **Identify all other infra dependencies** — search for S3, SNS, gRPC, FIX engines, proprietary TCP connections, external APIs, file system, SMTP
6. **Identify repo-resident operational configuration** — search deployment manifests, Helm values, Docker Compose, ingress/load balancer settings, probe configuration, queue consumer settings, resource limits, environment templates, and config precedence documentation
7. **For each dependency found**:
   - Record the exact class/method where the interaction occurs
   - Record any retry/timeout/circuit-breaker configuration (Polly policies, `HttpClient.Timeout`, custom retry loops)
   - Record concurrency, pool, batching, throttling, or backpressure controls if present
   - Record what data is being sent/received and why (from the calling context)
   - Record error handling (try/catch, fallback behavior)
   - Record how the effective value is determined: code default, config key, env var, deployment override, or unknown
   - Record whether a cancellation token is accepted and propagated to the outbound call

### Phase 2: Workflow Mapping

Using the dependency inventory from Phase 1:

1. **Trace ALL workflows** — identify every entry point (API controllers, message consumers, scheduled jobs, background tasks) and map the complete processing path for each, including all external calls and persistence steps. Do not limit to a predefined subset; discover workflows from the code.
2. **Document the sequence of dependency interactions** per workflow step
3. **Identify failure modes** for each step by examining:
   - What exceptions are caught/thrown
   - What happens when a dependency is unavailable
   - Whether processing continues or halts
   - Whether there is any dead-letter / retry queue behavior
4. **Treat lifecycle paths as workflows when they touch dependencies** — include startup initialization, readiness/liveness checks, recovery after restart, replay/reprocessing, and graceful shutdown/drain behavior.
5. **Mark async boundaries explicitly** — identify where work is handed off to queues, background workers, callbacks, or scheduled retry mechanisms so timeout and failure ownership stays clear.

### Phase 3: Consistency & Discrepancy Analysis

Using the completed workflow tables from Phase 2, perform a **cross-cutting comparison** of all dependency interactions:

1. **Extract all timeout values** into a single comparison table. Flag:
   - Dependencies with NO explicit timeout
   - Timeouts that exceed the parent workflow or caller timeout
   - Identical timeouts applied to operations of vastly different expected latency
   - Child timeouts that cannot complete within parent timeout bounds

2. **Extract all retry configurations** into a single comparison table. Flag:
   - Dependencies with NO retry policy
   - Inconsistent retry counts for dependencies of equivalent criticality
   - Retries on non-idempotent operations without deduplication
   - Missing circuit breakers on dependencies with high retry counts
   - Retries that include non-retryable status codes (e.g., 400, 404)
   - Missing retries on retryable conditions (e.g., 429, 503)

3. **Extract all error handling patterns** into a single comparison table. Flag:
   - Swallowed exceptions where data loss is not explicitly acceptable
   - Inconsistent halt-vs-continue decisions for failures of similar severity
   - Missing compensating actions for partial-state scenarios
   - Error responses that mask root cause

4. **Extract observability coverage** into a comparison table. Flag:
   - Dependencies with no failure logging or metrics
   - Missing correlation ID propagation
   - Success-only logging (can't detect degradation rates)

5. **Map business criticality to protection level**. Flag:
   - High-criticality dependencies with weak protection
   - Low-criticality dependencies with excessive protection adding latency
   - Dependencies where failure of a non-critical call blocks critical processing

6. **Assess caching appropriateness** for every dependency interaction. Flag:
   - High-frequency calls for low-volatility data that are NOT cached (**[DISCREPANCY: cacheable data fetched on every call]**)
   - Calls inside loops or per-item processing that could be batched or pre-fetched
   - Caches with TTLs misaligned to data volatility (too short = cache thrashing; too long = stale decisions)
   - Missing cache invalidation for data that can change mid-session
   - Cache stampede risks (many concurrent misses for same key)

7. **Extract capacity and backpressure controls** into a comparison table. Flag:
   - Unbounded concurrency, connection usage, or consumer prefetch
   - Missing bulkheads / isolation between critical and non-critical work
   - Retry amplification across layers
   - Overload behavior that blocks indefinitely instead of shedding, queuing intentionally, or failing fast

8. **Analyze lifecycle resiliency** across startup, readiness, liveness, and shutdown. Flag:
   - Startup dependencies that can deadlock or crash the service unnecessarily
   - Readiness/liveness checks that do not reflect whether the service can safely take traffic
   - Shutdown paths that can lose in-flight work
   - Missing replay/reconciliation after restart for partial work

9. **Resolve effective configuration where possible**. Flag:
   - Values documented from code defaults only when deployment overrides likely exist
   - Conflicting timeout/retry/concurrency settings across code, config, and deployment artifacts
   - Settings whose effective values are unknowable from the repo and must be verified at runtime

10. **Analyze cancellation token usage** across all workflows and dependency interactions. Flag:
    - Entry points (controllers, message handlers, background tasks) that do not accept or create a cancellation token
    - Outbound calls (HTTP, DB, cache, queue) where a cancellation token is available in scope but not passed
    - Long-running loops or batch operations that never check for cancellation
    - Methods that accept a token parameter but default it to `CancellationToken.None` or equivalent without justification
    - Requests that continue executing expensive downstream work after the caller has timed out and retried, wasting compute and potentially causing duplicate side effects
    - Missing cleanup or rollback when cancellation is observed mid-operation

11. **For every discrepancy found**: Add a **[DISCREPANCY]** tag in the Action Items column of the relevant workflow table row, AND add an entry to Section 4 (Consistency Analysis) with:
   - What the discrepancy is
   - What the expected/consistent pattern would be
   - A question for the team: "Is this intentional? If so, document the justification. If not, remediate."

### Phase 4: Synthesis & Gap Analysis

1. Combine outputs into the standardized format, starting with the prioritized Executive Summary
2. If multiple services are being reviewed: cross-reference interactions (if Service A calls Service B, verify details match from both perspectives)
3. Flag any unknowns that require:
   - Infrastructure-level verification (load balancer timeouts, DNS config)
   - Runtime observation (logs for actual retry behavior)
   - Team input (intended SLA, business priority of workflows)

---

## Rules

1. **NEVER invent implementation details.** Every claim must reference a specific file and line number.
2. **NEVER guess the "why".** If the purpose of a dependency call isn't clear from the code/comments, mark it as `[UNKNOWN: purpose not clear from code — needs team input]`.
3. **Use sub-agents** (Explore agent) for parallel codebase investigation.
4. **Include file references** for every finding (e.g., `src/MyService/SomeClass.cs:L45`).
5. **Mark confidence levels**:
   - ✅ Verified from code
   - ⚠️ Inferred from context (explain reasoning)
   - ❓ Unknown / needs verification
6. **Do NOT analyze test code** for behavior — tests may not reflect production behavior. Tests can be used to *confirm* behavior found in source.
7. **Include configuration source** for every timeout/retry value (which file, env var, or hardcoded constant).
8. **Cover ALL workflows** — every entry point must be accounted for. If an entry point shares a path with another workflow, note it in the workflow description rather than duplicating the table.
9. **Cross-service interactions** — Only document dependencies **from the perspective of the service being analyzed**. Do not document the callee's side.
10. **Challenge every inconsistency.** If two dependencies of similar type or criticality have different timeout/retry/error-handling configurations, mark it as **[DISCREPANCY]** and ask the team to justify. Do NOT assume the inconsistency is intentional.
11. **No implicit defaults.** If a dependency relies on framework/platform defaults (e.g., HttpClient 100s timeout, SQL Server 30s command timeout), explicitly call this out. Relying on implicit defaults is a finding — the team must confirm the default is acceptable or set an explicit value.
12. **Verify timeout arithmetic.** For any workflow with sequential dependency calls, verify that the sum of worst-case timeouts (per-try × retries × sequential calls) fits within the workflow's overall timeout or the caller's patience. If it doesn't, flag as **[DISCREPANCY: timeout budget exceeded]**.
13. **Question swallowed exceptions.** Every `catch` that logs-and-continues is a potential data loss point. For each one, the review must state: what data is lost, who detects the loss, and what the recovery mechanism is. If these are unknown, mark as **[DISCREPANCY: unacknowledged data loss]**.
14. **Verify idempotency for retried operations.** Any operation that is retried must be idempotent OR have deduplication at the receiver. If neither is verified, flag as **[DISCREPANCY: retry without idempotency guarantee]**.
15. **Every workflow row must include evidence and confidence.** Do not leave either blank. If no direct evidence is available, mark the row as `❓ Unknown / needs verification` and say what is missing.
16. **Operational config is in scope.** Do not stop at application code; search repo-resident deployment and environment configuration for the values that actually shape resiliency.
17. **Prefer effective values over declared defaults.** If multiple layers can override a timeout, retry, queue, or concurrency setting, document the precedence chain and only state the effective value when it is provable.
18. **Prioritize for action.** The Executive Summary must highlight the highest-risk findings by severity and blast radius, not just list everything discovered.
19. **Verify cancellation token propagation.** Every async outbound call should receive a cancellation token linked to the request or operation timeout. If a token is available in scope but not passed, flag as **[DISCREPANCY: cancellation token not propagated]**. If an entry point does not accept or create a token at all, flag as **[DISCREPANCY: no cancellation support]**. Wasted work from abandoned requests is a resource leak and a correctness risk when side effects are involved.
