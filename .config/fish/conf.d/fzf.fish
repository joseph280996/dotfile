#!/usr/bin/fish

# FZF config
set -gx FZF_DEFAULT_OPTS "$FZF_DEFAULT_OPTS \
  --style=full \
  --highlight-line \
  --info=inline-right \
  --ansi \
  --layout=reverse \
  --border=none \
  --color=bg+:#2d4f67 \
  --color=bg:#1f1f28 \
  --color=border:#54546d \
  --color=fg:#dcd7ba \
  --color=gutter:#1f1f28 \
  --color=header:#c34043 \
  --color=hl+:#e6c384 \
  --color=hl:#c0a36e \
  --color=info:#727169 \
  --color=marker:#76946a \
  --color=pointer:#7e9cd8 \
  --color=prompt:#957fb8 \
  --color=query:#dcd7ba:regular \
  --color=scrollbar:#54546d \
  --color=separator:#54546d \
  --color=spinner:#ffa066 \
"

set -gx FZF_CTRL_T_OPTS " \
  --walker-skip .git,node_modules,target \
  --preview 'bat -n --color=always {}' \
  --bind 'ctrl-/:change-preview-window(down|hidden|)'"

