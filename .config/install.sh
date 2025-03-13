#!/bin/bash

if [[ -f /etc/os-release ]]; then
    # Linux distribution detection
    . /etc/os-release
    if [[ "$ID" == "arch" ]]; then
        echo "You are running ArchLinux"
    else
        # Check if running in WSL (Windows Subsystem for Linux)
        if grep -q Microsoft /proc/version; then
            echo "You are running Windows (WSL)"
        else
            echo "You are running Linux ($PRETTY_NAME)"
        fi
    fi
elif [[ "$(uname)" == "Darwin" ]]; then
    # macOS detection
    echo "You are running macOS"
    # Optional: Get specific macOS version
    sw_vers | grep ProductVersion | awk '{print $2}'
else
    echo "Unknown operating system"
fi
