#!/usr/bin/env bash
# Detect broken skill symlinks (including symlink loops) in ~/.agents/skills
# and ~/.claude/skills. A symlink->symlink loop resolves to nothing, so a
# simple "-e resolves?" check catches both. Exit 1 if any are found.
set -euo pipefail

dirs=("$HOME/.agents/skills" "$HOME/.claude/skills")
broken=0

for dir in "${dirs[@]}"; do
  [[ -d "$dir" ]] || continue
  while IFS= read -r -d '' link; do
    if [[ ! -e "$link" ]]; then
      echo "BROKEN: $link -> $(readlink "$link")" >&2
      broken=1
    fi
  done < <(find "$dir" -type l -print0)
done

if (( broken )); then
  echo "Tip: restore real content in ~/.agents/skills first, then relink the other side." >&2
  exit 1
fi
echo "All skill links resolve."
