#!/usr/bin/env python3
"""
splunk_query.py — Query Splunk for Eclipse service logs.

Usage:
    python splunk_query.py [OPTIONS]

Options:
    --service <name>       Service name or alias (e.g. publisher, peprocessor, valuation, router)
                           Use 'all' to query all services. Overridden by --sourcetype.
    --sourcetype <type>    Explicit Splunk sourcetype. Repeatable for multiple sourcetypes
                           (overrides --service).
    --index <name>         Explicit Splunk index (used with --sourcetype, defaults from services.json)
    --search <terms>       Additional search terms / SPL fragment appended to the base query
    --earliest <time>      Earliest time bound (default: -1h). Splunk relative or absolute format.
    --latest <time>        Latest time bound (default: now)
    --level <LEVEL>        Filter by log level: DEBUG, INFO, WARN, ERROR (case-insensitive)
    --keyword <word>       Shorthand: search for a keyword in the Message field
    --correlation-id <id>  Filter by CorrelationId field
    --job-id <id>          Filter by JobId field
    --count <n>            Max results to return (default: 100, max: 1000)
    --stats <field>        Append '| stats count by <field>' for aggregation
    --raw-spl <spl>        Run a fully custom SPL query (ignores --service/--level/--keyword)
    --format <fmt>         Output format: table (default), json, raw
    --services-file <path> Path to services.json (default: auto-detected relative to this script)

Environment Variables:
    SPLUNK_HOST       Hostname (and optional :port) for Splunk, e.g. splunk.internal or splunk.internal:8089
    SPLUNK_USERNAME   Splunk username
    SPLUNK_PASSWORD   Splunk password

Examples:
    # Last hour of ERROR logs from the Publisher service
    python splunk_query.py --service publisher --level ERROR

    # Search for a specific exception across all services
    python splunk_query.py --service all --keyword "NullReferenceException" --earliest -4h

    # Track a batch job across services
    python splunk_query.py --service all --job-id "abc-123-xyz" --earliest -24h

    # Aggregated error counts by service
    python splunk_query.py --service all --level ERROR --stats sourcetype --earliest -24h

    # Query a Rancher 1.6 service not in services.json
    python splunk_query.py --sourcetype "ims-eos" --index docker --level ERROR --earliest -4h

    # Query app + sidecar together without writing raw SPL
    python splunk_query.py --sourcetype "ims-eos" --sourcetype "ims-eos-postgres" --index docker --earliest -2h

    # Custom SPL
    python splunk_query.py --raw-spl 'search index=main sourcetype="kube:container:publisher-service" | stats count by Level'
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.request
import urllib.parse
import urllib.error
import ssl
from pathlib import Path

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

DEFAULT_PORT = 8089
POLL_INTERVAL = 2  # seconds between job status polls
MAX_POLL_SECONDS = int(os.environ.get("SPLUNK_MAX_POLL_SECONDS", "120"))


def load_configuration() -> None:
    """Load configuration from environment, .env file, and keyring."""
    from configuration_loader import load_configuration
    load_configuration()


def load_services(services_file: str | None = None) -> dict:
    if services_file:
        path = Path(services_file)
    else:
        # Auto-detect: look relative to this script
        script_dir = Path(__file__).parent
        path = script_dir.parent / "assets" / "services.json"

    if not path.exists():
        return {"default_index": "main", "services": {}}

    with open(path) as f:
        return json.load(f)


def resolve_service_targets(service_arg: str, services_data: dict, default_index: str) -> list[dict]:
    """Resolve a service name/alias to a list of targets with index + sourcetype."""
    services = services_data.get("services", {})

    if service_arg == "all":
        return [
            {"index": s.get("index", default_index), "sourcetype": s["sourcetype"]}
            for s in services.values()
        ]

    # Direct key match
    if service_arg in services:
        svc = services[service_arg]
        return [{"index": svc.get("index", default_index), "sourcetype": svc["sourcetype"]}]

    # Alias match
    for svc in services.values():
        if service_arg in svc.get("aliases", []):
            return [{"index": svc.get("index", default_index), "sourcetype": svc["sourcetype"]}]

    print(f"[warn] Unknown service '{service_arg}'. Known services: {', '.join(services.keys())}",
          file=sys.stderr)
    return []


def build_ssl_context() -> ssl.SSLContext:
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def splunk_request(url: str, method: str = "GET", data: dict | None = None,
                   username: str = "", password: str = "") -> dict | str:
    """Make an authenticated Splunk API call. Returns parsed JSON or raw text."""
    ctx = build_ssl_context()

    encoded_data = urllib.parse.urlencode(data).encode() if data else None
    req = urllib.request.Request(url, data=encoded_data, method=method)

    # Basic auth
    import base64
    credentials = base64.b64encode(f"{username}:{password}".encode()).decode()
    req.add_header("Authorization", f"Basic {credentials}")

    if encoded_data:
        req.add_header("Content-Type", "application/x-www-form-urlencoded")

    try:
        with urllib.request.urlopen(req, context=ctx, timeout=30) as resp:
            body = resp.read().decode()
            try:
                return json.loads(body)
            except json.JSONDecodeError:
                return body
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"[error] HTTP {e.code} from Splunk: {body}", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"[error] Cannot connect to Splunk: {e.reason}", file=sys.stderr)
        sys.exit(1)


def run_search(base_url: str, spl: str, earliest: str, latest: str,
               username: str, password: str) -> str:
    """Submit an async search job and return the SID."""
    url = f"{base_url}/services/search/jobs"
    # SPL must start with "search " for most queries
    search_str = spl if spl.lstrip().startswith("search ") else f"search {spl}"

    data = {
        "search": search_str,
        "earliest_time": earliest,
        "latest_time": latest,
        "output_mode": "json",
    }
    result = splunk_request(url, method="POST", data=data, username=username, password=password)
    sid = result.get("sid")
    if not sid:
        print(f"[error] Failed to create search job: {result}", file=sys.stderr)
        sys.exit(1)
    return sid


def wait_for_job(base_url: str, sid: str, username: str, password: str) -> int:
    """Poll until the search job is done. Returns result count."""
    url = f"{base_url}/services/search/jobs/{sid}?output_mode=json"
    elapsed = 0
    while elapsed < MAX_POLL_SECONDS:
        result = splunk_request(url, username=username, password=password)
        entry = result.get("entry", [{}])[0]
        content = entry.get("content", {})
        state = content.get("dispatchState", "")
        result_count = content.get("resultCount", 0)

        if state == "DONE":
            return result_count
        if state in ("FAILED", "FATAL"):
            print(f"[error] Search job failed: {content.get('messages', '')}", file=sys.stderr)
            sys.exit(1)

        time.sleep(POLL_INTERVAL)
        elapsed += POLL_INTERVAL
        print(f"[...] Search state: {state} ({elapsed}s)", file=sys.stderr)

    print(f"[error] Search timed out after {MAX_POLL_SECONDS}s", file=sys.stderr)
    print(f"  HINT: Try narrowing the time range (--earliest \"-2h\"), adding filters "
          f"(sourcetype=, Level=, \"k8s.pod.name\"=), or using | stats/| head to reduce results.",
          file=sys.stderr)
    sys.exit(1)


def fetch_results(base_url: str, sid: str, count: int,
                  username: str, password: str) -> list[dict]:
    """Fetch paginated results from a completed search job."""
    all_results = []
    offset = 0
    page_size = min(count, 1000)

    while offset < count:
        url = (f"{base_url}/services/search/jobs/{sid}/results"
               f"?output_mode=json&count={page_size}&offset={offset}")
        data = splunk_request(url, username=username, password=password)
        results = data.get("results", [])
        if not results:
            break
        all_results.extend(results)
        offset += len(results)
        if len(results) < page_size:
            break

    return all_results[:count]


def format_table(results: list[dict]) -> str:
    """Format results as a readable table-like output."""
    if not results:
        return "(no results)"

    lines = []
    for i, event in enumerate(results, 1):
        raw = event.get("_raw", "")
        ts = event.get("_time", "")
        sourcetype = event.get("sourcetype", "")
        level = event.get("Level", "")
        message = event.get("Message", "")

        if message:
            # Structured log event
            line = f"[{i:4d}] {ts[:19]}  {sourcetype:<45} {level:<5}  {message[:200]}"
        elif raw:
            # Raw text event
            line = f"[{i:4d}] {ts[:19]}  {raw[:200]}"
        else:
            # Stats / aggregation result — print all fields as key=value
            # Include _time if present (essential for timechart output)
            ts_prefix = f"{ts[:19]}  " if ts else ""
            fields = "  ".join(f"{k}={v}" for k, v in event.items() if not k.startswith("_"))
            line = f"[{i:4d}] {ts_prefix}{fields}"
        lines.append(line)

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    # Pre-process argv: rewrite "--earliest -1h" -> "--earliest=-1h" so argparse
    # doesn't interpret Splunk relative times (e.g. -1h, -24h) as flags.
    _argv = sys.argv[1:]
    for _time_flag in ("--earliest", "--latest"):
        for _i, _a in enumerate(_argv):
            if _a == _time_flag and _i + 1 < len(_argv) and _argv[_i + 1].startswith("-"):
                _argv[_i + 1] = f"{_time_flag}={_argv[_i + 1]}"
                _argv[_i] = None  # will be dropped below
    _argv = [a for a in _argv if a is not None]

    parser = argparse.ArgumentParser(
        description="Query Splunk for Eclipse service logs",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--service", default=None,
                        help="Service name or alias (e.g. publisher, peprocessor, all)")
    parser.add_argument("--sourcetype", action="append", default=None,
                        help="Explicit Splunk sourcetype; repeat flag for multiple values (overrides --service)")
    parser.add_argument("--index", default=None,
                        help="Explicit Splunk index (used with --sourcetype)")
    parser.add_argument("--search", default=None,
                        help="Additional SPL terms appended to the query")
    parser.add_argument("--earliest", default="-1h",
                        help="Earliest time bound (default: -1h). Use quotes for relative times, e.g. --earliest -1h")
    parser.add_argument("--latest", default="now",
                        help="Latest time bound (default: now)")
    parser.add_argument("--level", default=None,
                        help="Log level filter: DEBUG, INFO, WARN, ERROR")
    parser.add_argument("--keyword", default=None,
                        help="Keyword to search in Message field")
    parser.add_argument("--correlation-id", default=None,
                        help="Filter by CorrelationId")
    parser.add_argument("--job-id", default=None,
                        help="Filter by JobId")
    parser.add_argument("--count", type=int, default=100,
                        help="Max results to return (default: 100)")
    parser.add_argument("--stats", default=None,
                        help="Append '| stats count by <field>' (e.g. Level, sourcetype)")
    parser.add_argument("--raw-spl", default=None,
                        help="Fully custom SPL (ignores service/level/keyword args)")
    parser.add_argument("--format", choices=["table", "json", "raw"], default="table",
                        help="Output format (default: table)")
    parser.add_argument("--services-file", default=None,
                        help="Path to services.json")

    args = parser.parse_args(_argv)

    load_configuration()

    # --- Environment ---
    host = os.environ.get("SPLUNK_HOST", "")
    username = os.environ.get("SPLUNK_USERNAME", "")
    password = os.environ.get("SPLUNK_PASSWORD", "")

    if not host or not username or not password:
        missing = [v for v, k in [("SPLUNK_HOST", host), ("SPLUNK_USERNAME", username),
                                    ("SPLUNK_PASSWORD", password)] if not k]
        print(f"[error] Missing environment variables: {', '.join(missing)}", file=sys.stderr)
        sys.exit(1)

    # Strip any scheme prefix — we always use https
    host = host.strip().rstrip("/")
    for prefix in ("https://", "http://"):
        if host.startswith(prefix):
            host = host[len(prefix):]

    # Add port if not present
    if ":" not in host.split("/")[-1]:
        host = f"{host}:{DEFAULT_PORT}"
    base_url = f"https://{host}"

    # --- Build SPL ---
    services_data = load_services(args.services_file)
    default_index = services_data.get("default_index", services_data.get("index", "main"))

    if args.raw_spl:
        spl = args.raw_spl
    else:
        if not args.service and not args.sourcetype:
            print("[error] Provide --service, --sourcetype, or --raw-spl", file=sys.stderr)
            sys.exit(1)

        # Resolve search targets (index + sourcetype)
        if args.sourcetype:
            targets = [
                {"index": args.index or default_index, "sourcetype": st}
                for st in args.sourcetype
            ]
        else:
            targets = resolve_service_targets(args.service, services_data, default_index)
            if not targets:
                sys.exit(1)

        # Build source clause across one or more index/sourcetype pairs
        if len(targets) == 1:
            t = targets[0]
            source_clause = f'index="{t["index"]}" sourcetype="{t["sourcetype"]}"'
        else:
            source_parts = [
                f'(index="{t["index"]}" sourcetype="{t["sourcetype"]}")'
                for t in targets
            ]
            source_clause = "(" + " OR ".join(source_parts) + ")"

        spl = source_clause

        # Optional filters
        if args.level:
            lvl = args.level.upper()
            spl += f' (Level="{lvl}" OR level="{lvl.lower()}")'
        if args.keyword:
            spl += f' "{args.keyword}"'
        if args.correlation_id:
            spl += f' CorrelationId="{args.correlation_id}"'
        if args.job_id:
            spl += f' JobId="{args.job_id}"'
        if args.search:
            spl += f" {args.search}"
        if args.stats:
            if args.stats.lower() == "count":
                spl += " | stats count"
            else:
                spl += f" | stats count by {args.stats}"

    print(f"[splunk] Host   : {base_url}", file=sys.stderr)
    print(f"[splunk] SPL    : {spl}", file=sys.stderr)
    if args.raw_spl:
        print(f"[splunk] Window : (embedded in SPL, defaults: {args.earliest} → {args.latest})", file=sys.stderr)
    else:
        print(f"[splunk] Window : {args.earliest} → {args.latest}", file=sys.stderr)

    # Warn about unquoted dotted fields in SPL
    # Match patterns like k8s.pod.name= that are NOT preceded by a double-quote
    unquoted_dotted = re.findall(r'(?<!")\bk8s\.\w+\.\w+', spl)
    if unquoted_dotted:
        print(f"[warn] Possible unquoted dotted field(s) in SPL: {', '.join(set(unquoted_dotted))}. "
              f'Dotted fields must be double-quoted, e.g. "k8s.pod.name"="value".',
              file=sys.stderr)

    # --- Execute ---
    sid = run_search(base_url, spl, args.earliest, args.latest, username, password)
    print(f"[splunk] Job SID: {sid}", file=sys.stderr)

    result_count = wait_for_job(base_url, sid, username, password)
    print(f"[splunk] Results: {result_count} (fetching up to {args.count})", file=sys.stderr)

    if result_count > 500 and not args.stats:
        print(f"[warn] Large result set ({result_count} events). Consider using --stats <field>, "
              f"or adding '| timechart span=5m count' or '| bin _time span=1m | stats count by _time' "
              f"to aggregate server-side.", file=sys.stderr)

    if result_count == 0:
        print("(no results found)")
        # Emit hints for common pitfalls
        hints = []
        if spl and ("k8s." in spl or "k8s_" in spl):
            # Check if dotted fields are properly quoted
            unquoted = re.findall(r'(?<!")k8s\.\w+\.\w+(?!=)', spl)
            if unquoted:
                hints.append(
                    f"HINT: Dotted field names must be double-quoted in SPL. "
                    f"Found unquoted: {', '.join(unquoted)}. "
                    f'Use e.g. "k8s.pod.name"="value" instead of k8s.pod.name="value"'
                )
        if args.level and args.level.upper() == "ERROR":
            hints.append(
                "HINT: Some events (e.g., connection timeouts) are logged as Level=WARN, not ERROR. "
                "Try searching with --search 'Level=WARN OR Level=ERROR' or without --level to broaden."
            )
        if args.earliest and ("7d" in args.earliest or "30d" in args.earliest or "14d" in args.earliest):
            hints.append(
                "HINT: Broad time ranges may return no results due to timeout. "
                "Try narrowing: --earliest \"-2h\" or --earliest \"-1d\"."
            )
        for hint in hints:
            print(f"  {hint}", file=sys.stderr)
        return

    results = fetch_results(base_url, sid, args.count, username, password)

    # --- Output ---
    if args.format == "json":
        print(json.dumps(results, indent=2))
    elif args.format == "raw":
        for event in results:
            print(event.get("_raw", json.dumps(event)))
    else:
        print(format_table(results))


if __name__ == "__main__":
    main()
