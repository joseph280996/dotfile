#!/bin/bash

if [[ -f /etc/os-release ]]; then
    # Linux distribution detection
    . /etc/os-release
    if [[ "$ID" == "arch" ]]; then
        echo "You are running ArchLinux"
    else
        # Check if running in WSL (Windows Subsystem for Linux)
        if grep -q Microsoft /proc/version; then
            [ ! -d "~/.config" ] && mkdir -p "~/.config"
            ln ./nvim ~/.config/nvim
            ln ./fish ~/.config/fish
            ln ./git ~/.config/git
        else
            echo "You are running Linux ($PRETTY_NAME)"
            [ ! -d "~/.config" ] && mkdir -p "~/.config"
            ln ./nvim ~/.config/nvim
            ln ./fish ~/.config/fish
            ln ./git ~/.config/git
        fi
    fi
elif [[ "$(uname)" == "Darwin" ]]; then
    # macOS detection
    echo "You are running macOS"
    [ ! -d "~/.config" ] && mkdir -p "~/.config"
    ln ./nvim ~/.config/nvim
    ln ./fish ~/.config/fish
    ln ./git ~/.config/git

else
    echo "Unknown operating system"
fi
