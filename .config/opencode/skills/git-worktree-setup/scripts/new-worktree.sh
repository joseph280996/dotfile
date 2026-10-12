#!/usr/bin/env bash
# new-worktree.sh — create a git worktree seeded with local-only setup changes
# from the main worktree, then run project setup.
#
# Usage:
#   new-worktree.sh create --branch <name> --base current|default [--existing reuse|fail] [--dry-run]
#   new-worktree.sh setup <dir> [--node-version <v>]
#
# Exit codes:
#   0  ok
#   1  fatal error
#   2  worktree created, but the patch had conflicts
#   3  worktree created, but the Node install failed
#   4  branch already exists and --existing fail

set -euo pipefail
shopt -s nullglob

usage() {
  cat >&2 <<'EOF'
usage: new-worktree.sh create --branch <name> --base current|default [--existing reuse|fail] [--dry-run]
       new-worktree.sh setup <dir> [--node-version <v>]

exit codes: 0 ok, 1 fatal, 2 patch conflicts, 3 node install failed, 4 branch exists
EOF
  exit 1
}

fail() { echo "error: $*" >&2; exit 1; }

main_worktree() {
  git worktree list --porcelain | sed -n 's/^worktree //p' | head -n 1
}

default_branch() {
  local main="$1" b
  if b=$(git -C "$main" symbolic-ref refs/remotes/origin/HEAD 2>/dev/null); then
    echo "${b#refs/remotes/origin/}"
    return
  fi
  if git -C "$main" rev-parse --verify --quiet refs/remotes/origin/master >/dev/null; then
    echo master
  elif git -C "$main" rev-parse --verify --quiet refs/remotes/origin/main >/dev/null; then
    echo main
  else
    fail "cannot determine default branch (no origin/HEAD, origin/master or origin/main)"
  fi
}

# One line per uncommitted file in the main worktree: "status<TAB>path".
# M/D: tracked changes vs HEAD (staged + unstaged), A: untracked non-ignored.
change_list() {
  local main="$1"
  git -C "$main" diff HEAD --name-status
  git -C "$main" ls-files --others --exclude-standard | sed 's/^/A\t/'
}

print_changes() {
  change_list "$1" | awk -F'\t' '{
  if (NF >= 3) printf "  %s  %s -> %s\n", $1, $2, $3
  else printf "  %s  %s\n", $1, $2
}'
}

cmd_create() {
  local branch="" base="" existing="fail" dry_run=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --branch) branch="$2"; shift 2 ;;
      --base) base="$2"; shift 2 ;;
      --existing) existing="$2"; shift 2 ;;
      --dry-run) dry_run=1; shift ;;
      *) usage ;;
    esac
  done
  [[ -n "$branch" && -n "$base" ]] || usage
  [[ "$base" == "current" || "$base" == "default" ]] || fail "--base must be current|default"
  [[ "$existing" == "reuse" || "$existing" == "fail" ]] || fail "--existing must be reuse|fail"

  local main wt base_commit
  main=$(main_worktree) || fail "not inside a git repository"
  main=$(cd "$main" && pwd)

  local main_name parent
  main_name=$(basename "$main")
  parent=$(dirname "$main")
  local dir_name="${branch//\//-}"
  wt="$parent/$main_name-$dir_name"

  local base_desc
  if [[ "$base" == "default" ]]; then
    echo "==> fetching origin" >&2
    git -C "$main" fetch origin --prune
    base_commit="origin/$(default_branch "$main")"
    base_desc="default ($base_commit @ $(git -C "$main" rev-parse --short "$base_commit"))"
  else
    # Resolve in the caller's checkout: -C "$main" would use the main
    # worktree's HEAD instead of the branch the user is standing on.
    base_commit=$(git rev-parse --verify HEAD)
    base_desc="current ($(git rev-parse --abbrev-ref HEAD) @ $(git rev-parse --short HEAD))"
  fi

  if [[ "$dry_run" == 1 ]]; then
    echo "worktree: $wt"
    echo "branch:   $branch"
    echo "base:     $base_desc"
    echo
    echo "setup changes to copy from $main:"
    print_changes "$main"
    return 0
  fi

  if git -C "$main" show-ref --verify --quiet "refs/heads/$branch"; then
    if [[ "$existing" == "fail" ]]; then
      echo "error: branch '$branch' already exists" >&2
      exit 4
    fi
    git -C "$main" worktree add "$wt" "$branch"
  else
    git -C "$main" worktree add -b "$branch" "$wt" "$base_commit"
  fi

  local conflicts=""
  local apply_err
  apply_err=$(mktemp)
  # Skip when the main worktree has no tracked changes: git apply exits 128
  # ("no valid patches") on empty input, which would read as a conflict.
  if ! git -C "$main" diff --quiet HEAD; then
    if ! git -C "$main" diff HEAD --binary | git -C "$wt" apply --3way 2>"$apply_err"; then
      conflicts=$(git -C "$wt" ls-files --unmerged 2>/dev/null | awk '{print $NF}' | sort -u)
      [[ -n "$conflicts" ]] || conflicts=$(cat "$apply_err")
    fi
  fi
  rm -f "$apply_err"

  # --3way implies --index: a clean apply stages the setup changes, and a
  # conflicted one still stages the hunks that applied cleanly. Reset in both
  # cases so a plain commit picks up none of them; conflict markers stay in
  # the files.
  git -C "$wt" reset -q

  # tar pipe: one process pair, NUL-safe, portable where rsync lacks
  # --from0/--target-directory (macOS openrsync). An empty file list yields
  # an empty archive, so no guard is needed here.
  ( cd "$main" && git ls-files --others --exclude-standard -z \
      | tar --null -T - -cf - ) | tar -xf - -C "$wt"

  local setup_status=0
  cmd_setup "$wt" || setup_status=$?

  echo
  echo "==> worktree: $wt"
  echo "==> branch:   $branch (base: $base_commit)"
  echo "==> setup files copied (local-only, do NOT commit):"
  print_changes "$main"
  if [[ -n "$conflicts" ]]; then
    echo "==> CONFLICTS (patch did not apply cleanly, fix manually):"
    while IFS= read -r c; do echo "==>   $c"; done <<< "$conflicts"
  fi

  if [[ "$setup_status" -ne 0 ]]; then
    exit "$setup_status"
  fi
  if [[ -n "$conflicts" ]]; then
    exit 2
  fi
  exit 0
}

# ---------- setup ----------

nvm_source() {
  local nvm_dir="${NVM_DIR:-$HOME/.nvm}"
  if [[ -s "$nvm_dir/nvm.sh" ]]; then
    # nvm.sh references unset NVM_* vars; some versions abort under set -u.
    set +u
    . "$nvm_dir/nvm.sh" >/dev/null 2>&1
    set -u
  fi
}

run_node() {
  local dir="$1" pinned="${2:-}"
  # -f filter instead of relying on nullglob: non-glob words like
  # "$dir/package.json" survive nullglob even when the file is absent.
  local pkgs=() p
  [[ -f "$dir/package.json" ]] && pkgs+=("$dir/package.json")
  for p in "$dir"/*/package.json; do
    [[ -f "$p" ]] && pkgs+=("$p")
  done
  local n=${#pkgs[@]}
  [[ $n -gt 0 ]] || return 0

  nvm_source
  local has_nvm=0
  type nvm >/dev/null 2>&1 && has_nvm=1
  if [[ $has_nvm -eq 0 ]]; then
    echo "node setup: nvm not found; using node on PATH ($(node --version 2>/dev/null || echo none))" >&2
  elif [[ -n "$pinned" ]]; then
    echo "node setup: nvm install/use $pinned" >&2
    nvm install "$pinned" >/dev/null 2>&1
    nvm use "$pinned" >&2
  elif [[ -f "$dir/.nvmrc" ]]; then
    local rc
    rc=$(sed 's/^[[:space:]]*//;s/[[:space:]]*$//' "$dir/.nvmrc")
    echo "node setup: .nvmrc -> $rc" >&2
    nvm install "$rc" >/dev/null 2>&1
    nvm use "$rc" >&2
  fi

  local pkg lock d out
  for pkg in "${pkgs[@]}"; do
    d=$(dirname "$pkg")
    lock=""
    [[ -f "$d/pnpm-lock.yaml" ]] && lock="pnpm"
    [[ -z "$lock" && -f "$d/yarn.lock" ]] && lock="yarn"
    echo "node setup: $d -> ${lock:-npm} install" >&2
    out=$(mktemp)
    if (
      cd "$d" || exit 1
      if [[ "$lock" == "pnpm" ]]; then
        pnpm install
      elif [[ "$lock" == "yarn" ]]; then
        yarn install
      else
        npm install
      fi
    ) >"$out" 2>&1; then
      tail -n 3 "$out" >&2
    else
      echo "node setup FAILED in $d (node: $(node --version 2>/dev/null || echo unknown))" >&2
      echo "--- last 20 lines of output ---" >&2
      tail -n 20 "$out" >&2
      rm -f "$out"
      return 3
    fi
    rm -f "$out"
  done
  return 0
}

run_go() {
  local dir="$1"
  local mods=() p
  for p in "$dir"/go.mod "$dir"/*/go.mod; do
    [[ -f "$p" ]] && mods+=("$p")
  done
  [[ ${#mods[@]} -gt 0 ]] || return 0
  local mod st=0
  for mod in "${mods[@]}"; do
    echo "go setup: $(dirname "$mod") -> go mod download" >&2
    (cd "$(dirname "$mod")" && go mod download) >&2 || st=1
  done
  return "$st"
}

run_dotnet() {
  local dir="$1"
  local targets=() p
  for p in "$dir"/*.sln "$dir"/*/*.sln "$dir"/*.csproj "$dir"/*/*.csproj; do
    [[ -f "$p" ]] && targets+=("$p")
  done
  local target st=0
  [[ ${#targets[@]} -gt 0 ]] || return 0
  for target in "${targets[@]}"; do
    echo "dotnet setup: $target -> dotnet restore" >&2
    dotnet restore "$target" >&2 || st=1
  done
  return "$st"
}

cmd_setup() {
  [[ $# -ge 1 ]] || usage
  local dir="$1"; shift
  local pinned=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --node-version) pinned="$2"; shift 2 ;;
      *) usage ;;
    esac
  done
  [[ -d "$dir" ]] || fail "not a directory: $dir"
  dir=$(cd "$dir" && pwd)

  # errexit is suspended for the callees (|| context) so one failing
  # ecosystem does not stop the others.
  # return (not exit): as a function, exit would kill the whole script and
  # skip create's summary. The CLI dispatch makes this the last command, so
  # the return value becomes the process exit code.
  local status=0
  run_dotnet "$dir" || status=$?
  run_go "$dir" || status=$?
  run_node "$dir" "$pinned" || status=$?
  return "$status"
}

case "${1:-}" in
  create) shift; cmd_create "$@" ;;
  setup) shift; cmd_setup "$@" ;;
  *) usage ;;
esac
