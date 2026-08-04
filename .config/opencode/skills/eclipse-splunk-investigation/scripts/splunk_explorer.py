#!/usr/bin/env python3
"""
splunk_explorer.py — Schema discovery for Splunk Eclipse indexes.

Queries the Splunk REST API to discover exact index names, sourcetypes, and
field names (with correct casing). Use this BEFORE writing any analytical query
to avoid silently wrong field name assumptions.

Usage:
    python splunk_explorer.py --mode list_indexes
    python splunk_explorer.py --mode list_sourcetypes --index main
    python splunk_explorer.py --mode list_fields --index main --sourcetype "kube:container:peprocessor-service"

Authentication (checked in order):
    1. SPLUNK_TOKEN      — Bearer token (preferred)
    2. SPLUNK_USERNAME + SPLUNK_PASSWORD — Basic auth

Environment Variables:
    SPLUNK_HOST       Splunk hostname with optional port (e.g. splunk.internal or splunk.internal:8089)
                      May include https:// prefix — it will be stripped.
    SPLUNK_TOKEN      Splunk auth token (optional, takes precedence)
    SPLUNK_USERNAME   Splunk username (used if SPLUNK_TOKEN not set)
    SPLUNK_PASSWORD   Splunk password (used if SPLUNK_TOKEN not set)

Output: JSON array printed to stdout (one item per line for easy piping).
Diagnostic messages go to stderr so stdout stays clean JSON.
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

import requests
from requests.auth import HTTPBasicAuth

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

DEFAULT_PORT = 8089
POLL_INTERVAL = 2
MAX_POLL_SECONDS = 120

# Internal Splunk indexes to exclude from list_indexes output
INTERNAL_INDEX_PREFIXES = ("_",)


# ---------------------------------------------------------------------------
# .env loader
# ---------------------------------------------------------------------------

def load_configuration() -> None:
    """Load configuration from environment, .env file, and keyring."""
    from configuration_loader import load_configuration
    load_configuration()


# ---------------------------------------------------------------------------
# Connection helpers
# ---------------------------------------------------------------------------

def build_base_url() -> str:
    host = os.environ.get("SPLUNK_HOST", "").strip().rstrip("/")
    if not host:
        print("[error] SPLUNK_HOST environment variable is not set.", file=sys.stderr)
        sys.exit(1)
    for prefix in ("https://", "http://"):
        if host.startswith(prefix):
            host = host[len(prefix):]
    if ":" not in host:
        host = f"{host}:{DEFAULT_PORT}"
    return f"https://{host}"


def build_session() -> tuple[requests.Session, str]:
    """Return (session, base_url). Session has auth and SSL config pre-applied."""
    base_url = build_base_url()
    session = requests.Session()
    session.verify = False  # Internal/self-signed certs

    token = os.environ.get("SPLUNK_TOKEN", "")
    username = os.environ.get("SPLUNK_USERNAME", "")
    password = os.environ.get("SPLUNK_PASSWORD", "")

    if token:
        session.headers.update({"Authorization": f"Bearer {token}"})
        print(f"[auth] Using SPLUNK_TOKEN", file=sys.stderr)
    elif username and password:
        session.auth = HTTPBasicAuth(username, password)
        print(f"[auth] Using SPLUNK_USERNAME/PASSWORD", file=sys.stderr)
    else:
        print("[error] No Splunk credentials found. Set SPLUNK_TOKEN or SPLUNK_USERNAME+SPLUNK_PASSWORD.",
              file=sys.stderr)
        sys.exit(1)

    return session, base_url


def splunk_get(session: requests.Session, url: str) -> dict:
    """Perform a GET request and return parsed JSON."""
    print(f"[GET]  {url}", file=sys.stderr)
    resp = session.get(url, timeout=30)
    resp.raise_for_status()
    return resp.json()


def splunk_export(session: requests.Session, base_url: str, spl: str) -> list[dict]:
    """
    Run a one-shot export search (blocking) and return all result rows as dicts.
    /services/search/jobs/export streams newline-delimited JSON.
    """
    url = f"{base_url}/services/search/jobs/export"
    data = {
        "search": spl if spl.lstrip().startswith("search") or spl.lstrip().startswith("|") else f"search {spl}",
        "output_mode": "json",
        "earliest_time": "-7d",   # wide window to ensure metadata is populated
        "latest_time": "now",
    }
    print(f"[POST] {url}", file=sys.stderr)
    print(f"[SPL]  {data['search']}", file=sys.stderr)

    resp = session.post(url, data=data, timeout=120, stream=True)
    resp.raise_for_status()

    rows = []
    for raw_line in resp.iter_lines():
        if not raw_line:
            continue
        try:
            obj = json.loads(raw_line)
        except json.JSONDecodeError:
            continue
        result = obj.get("result")
        if result:
            rows.append(result)

    return rows


# ---------------------------------------------------------------------------
# Modes
# ---------------------------------------------------------------------------

def mode_list_indexes(session: requests.Session, base_url: str) -> list[str]:
    """Return a sorted list of non-internal index names."""
    url = f"{base_url}/services/data/indexes?output_mode=json&count=0"
    data = splunk_get(session, url)

    indexes = []
    for entry in data.get("entry", []):
        name = entry.get("name", "")
        if name and not any(name.startswith(p) for p in INTERNAL_INDEX_PREFIXES):
            indexes.append(name)

    return sorted(indexes)


def mode_list_sourcetypes(session: requests.Session, base_url: str, index: str) -> list[str]:
    """Return a sorted list of sourcetypes in the given index."""
    spl = f"| metadata type=sourcetypes index={index} | table sourcetype"
    rows = splunk_export(session, base_url, spl)

    sourcetypes = sorted({row["sourcetype"] for row in rows if "sourcetype" in row})
    return sourcetypes


def mode_list_fields(session: requests.Session, base_url: str, index: str, sourcetype: str) -> list[str]:
    """Return a sorted list of field names extracted from real events (exact casing)."""
    spl = (
        f'search index={index} sourcetype="{sourcetype}" '
        f'| head 1000 | fieldsummary | table field'
    )
    rows = splunk_export(session, base_url, spl)

    fields = sorted({row["field"] for row in rows if "field" in row})
    return fields


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    load_configuration()

    # Pre-process argv to handle leading-dash values (e.g. time ranges)
    _argv = sys.argv[1:]
    for _flag in ("--earliest", "--latest"):
        for _i, _a in enumerate(_argv):
            if _a == _flag and _i + 1 < len(_argv) and _argv[_i + 1].startswith("-"):
                _argv[_i + 1] = f"{_flag}={_argv[_i + 1]}"
                _argv[_i] = None
    _argv = [a for a in _argv if a is not None]

    parser = argparse.ArgumentParser(
        description="Splunk schema discovery — indexes, sourcetypes, and fields",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--mode",
        required=True,
        choices=["list_indexes", "list_sourcetypes", "list_fields"],
        help="Discovery mode",
    )
    parser.add_argument("--index", default=None, help="Splunk index name (required for list_sourcetypes and list_fields)")
    parser.add_argument("--sourcetype", default=None, help="Exact sourcetype string (required for list_fields)")
    parser.add_argument("--pretty", action="store_true", help="Pretty-print JSON output")

    args = parser.parse_args(_argv)

    # Validate required args per mode
    if args.mode in ("list_sourcetypes", "list_fields") and not args.index:
        parser.error(f"--index is required for --mode {args.mode}")
    if args.mode == "list_fields" and not args.sourcetype:
        parser.error("--sourcetype is required for --mode list_fields")

    # Suppress InsecureRequestWarning for self-signed certs
    import urllib3
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

    session, base_url = build_session()
    print(f"[splunk] {base_url}", file=sys.stderr)

    if args.mode == "list_indexes":
        result = mode_list_indexes(session, base_url)
        print(f"[found] {len(result)} non-internal index(es)", file=sys.stderr)

    elif args.mode == "list_sourcetypes":
        result = mode_list_sourcetypes(session, base_url, args.index)
        print(f"[found] {len(result)} sourcetype(s) in index={args.index}", file=sys.stderr)

    elif args.mode == "list_fields":
        result = mode_list_fields(session, base_url, args.index, args.sourcetype)
        print(f"[found] {len(result)} field(s) for sourcetype={args.sourcetype}", file=sys.stderr)

    indent = 2 if args.pretty else None
    print(json.dumps(result, indent=indent))


if __name__ == "__main__":
    main()
