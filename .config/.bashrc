[[ $- != *i* ]] && return

CONFIG_DIR="C:/Users/josep/.config"

export FORCE_COLOR="1"
export PYTHONUTF8=1
export ERG_PATH="D:/packages/erg/crates/erg_compiler"
export ANTHROPIC_API_KEY="<Your Anthropic api key here>"
export KOMOREBI_CONFIG_HOME="<komorebi config location>"

export GPG_TTY=$(tty)

alias ls='ls --color=auto'
alias grep='grep --color=auto'
PS1='[\u@\h \W]\$ '

eval "$(oh-my-posh init bash --config $CONFIG_DIR/kanagawa-wave.omp.json)"
eval "$(zoxide init bash)"

[[ $PS1 && -f /usr/share/bash-completion/bash_completion ]] && \
    . /usr/share/bash-completion/bash_completion

bind 'TAB:menu-complete'
