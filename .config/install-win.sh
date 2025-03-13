#!/bin/bash

CONFIG_DOWNLOAD_LOCATION="<Input download location>"

pwsh "Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser"
pwsh "irm get.scoop.sh | iex"

scoop import ./Scoopfile.json


pwsh "New-Item -Item-Type SymbolicLink -Path ~/AppData/Local/nvim -Target ${CONFIG_DOWNLOAD_LOCATION}/nvim"
pwsh "New-Item -Item-Type SymbolicLink -Path ~/.gitconfig -Target ${CONFIG_DOWNLOAD_LOCATION}/.gitconfig"
pwsh "New-Item -Item-Type SymbolicLink -Path ~/.bashrc -Target ${CONFIG_DOWNLOAD_LOCATION}/.bashrc"
pwsh "New-Item -Item-Type SymbolicLink -Path ~/.bash_profile -Target ${CONFIG_DOWNLOAD_LOCATION}/.bash_profile"

[ -d "/path/to/folder" ] || mkdir -p "~/.config"

pwsh "New-Item -Item-Type SymbolicLink -Path ~/.config/wezterm -Target ${CONFIG_DOWNLOAD_LOCATION}/wezterm"

pwsh "New-Item -Item-Type SymbolicLink -Path ~/.config/kanagawa-wave.omp.json -Target ${CONFIG_DOWNLOAD_LOCATION}/kanagawa-wave.omp.json"

pwsh "New-Item -Item-Type SymbolicLink -Path ~/.config/komorebi -Target ${CONFIG_DOWNLOAD_LOCATION}/komorebi"
