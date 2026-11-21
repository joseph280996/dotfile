# The following lines were added by Docker Desktop to add commands to your PATH.
export PATH="$PATH:/Users/tpham4/.docker/bin"
# End of Docker Desktop section.

if status is-interactive
end

### MANAGED BY RANCHER DESKTOP START (DO NOT EDIT)
set --export --prepend PATH "$HOME/.rd/bin"
### MANAGED BY RANCHER DESKTOP END (DO NOT EDIT)

# lean-ctx shell hook — begin
if test -f "$HOME/.lean-ctx/shell-hook.fish"
source "$HOME/.lean-ctx/shell-hook.fish"
end
# lean-ctx shell hook — end
