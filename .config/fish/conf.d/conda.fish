#!/usr/bin/fish

# >>> conda initialize >>>
# !! Contents within this block are managed by 'conda init' !!
if test -f /Users/joseph280996/miniconda3/bin/conda
    eval /Users/joseph280996/miniconda3/bin/conda "shell.fish" "hook" $argv | source
else
    if test -f "/Users/joseph280996/miniconda3/etc/fish/conf.d/conda.fish"
        . "/Users/joseph280996/miniconda3/etc/fish/conf.d/conda.fish"
    else
        set -x PATH "/Users/joseph280996/miniconda3/bin" $PATH
    end
end
# <<< conda initialize <<<
