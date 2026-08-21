#!/usr/bin/env bash
set -euo pipefail

SKILLS_DIR="$HOME/.config/opencode/skills"
SOURCE_DIR="$HOME/Code/Personal/ECC/skills"

if [[ ! -d "$SKILLS_DIR" ]]; then
  echo "Skills directory not found: $SKILLS_DIR" >&2
  exit 1
fi

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "Source skills directory not found: $SOURCE_DIR" >&2
  exit 1
fi

# Vendored copy, not a symlink: ECC is a third-party repo pulled
# independently, and these skills are prompt-injection surface for every
# agent that loads them. Symlinking would make a `git pull` in ECC
# silently change agent instructions here with no diff to review, and
# would leave dangling links on a fresh machine where ECC isn't checked
# out (this repo's own install.fish just does `ln -s ... ~/.config`, so
# it has to stay self-contained). rsync copies the content in so updates
# show up as a reviewable diff in this repo.
for skill_path in "$SKILLS_DIR"/*/; do
  skill_name="$(basename "$skill_path")"

  if [[ ! -e "$SOURCE_DIR/$skill_name" ]]; then
    echo "Skipping '$skill_name': not found in $SOURCE_DIR" >&2
    continue
  fi

  echo "Syncing $skill_name"
  rsync -a --delete "$SOURCE_DIR/$skill_name/" "$SKILLS_DIR/$skill_name/"
done

echo "Done."

# NOTE: agent syncing from ECC was intentionally removed.
# ECC's prompts/agents/*.txt files are bare prompt bodies with no
# frontmatter (no name/description/mode/model/permission) -- they're
# meant to be referenced via {file:...} inside ECC's own opencode.json
# agent: block, not dropped in as standalone .opencode/agent/*.md files.
# Our agents/*.md files also carry a hand-added "Prompt Defense Baseline"
# security header that ECC's source does not have. Symlinking would
# silently strip both, breaking these agents. Agents are hand-maintained
# in ~/.config/opencode/agents/ instead.
