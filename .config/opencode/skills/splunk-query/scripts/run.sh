#!/usr/bin/env bash
# cross-platform bun wrapper — installs bun automatically if missing, then runs the given script.
# usage: bash scripts/run.sh scripts/query.ts
set -euo pipefail

ensure_bun() {
  if command -v bun &>/dev/null; then
    return
  fi

  echo "bun not found — installing automatically..." >&2

  if [[ "$OSTYPE" == darwin* ]] || [[ "$OSTYPE" == linux* ]]; then
    curl -fsSL https://bun.sh/install | bash >/dev/null 2>&1
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"
  else
    echo "automatic bun install not supported on this OS ($OSTYPE)" >&2
    echo "install manually: https://bun.sh" >&2
    exit 1
  fi

  if ! command -v bun &>/dev/null; then
    echo "bun installation failed — install manually: https://bun.sh" >&2
    exit 1
  fi

  echo "bun installed successfully ($(bun --version))" >&2
}

ensure_bun
exec bun "$@"
