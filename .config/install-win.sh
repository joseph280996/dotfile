#!/bin/bash

CONFIG_DOWNLOAD_LOCATION="<Input download location>"

pwsh "Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser"
pwsh "irm get.scoop.sh | iex"

scoop import ./Scoopfile.json


pwsh "New-Item -Item-Type SymbolicLink -Path ~/AppData/Local/nvim -Target ${CONFIG_DOWNLOAD_LOCATION}/nvim"
pwsh "New-Item -Item-Type SymbolicLink -Path ~/.bashrc -Target ${CONFIG_DOWNLOAD_LOCATION}/.bashrc"
pwsh "New-Item -Item-Type SymbolicLink -Path ~/.bash_profile -Target ${CONFIG_DOWNLOAD_LOCATION}/.bash_profile"
pwsh "New-Item -Item-Type SymbolicLink -Path ~/.npmrc -Target ${CONFIG_DOWNLOAD_LOCATION}/.npmrc"
pwsh "New-Item -Item-Type SymbolicLink -Path ~/.condarc -Target ${CONFIG_DOWNLOAD_LOCATION}/.condarc"
pwsh "New-Item -Item-Type SymbolicLink -Path ~/.yarnrc -Target ${CONFIG_DOWNLOAD_LOCATION}/.yarnrc"

[ ! -d "~/.config" ] && mkdir -p "~/.config"

pwsh "New-Item -Item-Type SymbolicLink -Path ~/.config/wezterm -Target ${CONFIG_DOWNLOAD_LOCATION}/wezterm"

pwsh "New-Item -Item-Type SymbolicLink -Path ~/.config/kanagawa-wave.omp.json -Target ${CONFIG_DOWNLOAD_LOCATION}/kanagawa-wave.omp.json"

pwsh "New-Item -Item-Type SymbolicLink -Path ~/.config/komorebi -Target ${CONFIG_DOWNLOAD_LOCATION}/komorebi"

pwsh "New-Item -Item-Type SymbolicLink -Path ~/.config/git -Target ${CONFIG_DOWNLOAD_LOCATION}/git"
