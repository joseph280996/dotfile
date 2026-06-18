if status is-interactive
end

string match -q "$TERM_PROGRAM" "kiro" and . (kiro --locate-shell-integration-path fish)

### MANAGED BY RANCHER DESKTOP START (DO NOT EDIT)
set --export --prepend PATH "/Users/tpham4/.rd/bin"
### MANAGED BY RANCHER DESKTOP END (DO NOT EDIT)
# lean-ctx shell hook — begin
if test -f "/Users/tpham4/.config/lean-ctx/shell-hook.fish"
source "/Users/tpham4/.config/lean-ctx/shell-hook.fish"
end
# lean-ctx shell hook — end
