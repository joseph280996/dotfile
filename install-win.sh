#!/bin/bash

CONFIG_DOWNLOAD_LOCATION=$(pwd)

echo "Started installing Scoop..."
pwsh "Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser"
pwsh "irm get.scoop.sh | iex"
echo "Finished installing scoop..."

echo "Started importing scoop packages..."
scoop import ./Scoopfile.json
echo "Finished importing scoop packages..."

echo "Started creating symbolic links for the configuration files..."
pwsh "New-Item -Item-Type SymbolicLink -Path ~/.bashrc -Target ${CONFIG_DOWNLOAD_LOCATION}/.bashrc"
pwsh "New-Item -Item-Type SymbolicLink -Path ~/.bash_profile -Target ${CONFIG_DOWNLOAD_LOCATION}/.bash_profile"
pwsh "New-Item -Item-Type SymbolicLink -Path ~/.npmrc -Target ${CONFIG_DOWNLOAD_LOCATION}/.npmrc"
pwsh "New-Item -Item-Type SymbolicLink -Path ~/.condarc -Target ${CONFIG_DOWNLOAD_LOCATION}/.condarc"
pwsh "New-Item -Item-Type SymbolicLink -Path ~/.yarnrc -Target ${CONFIG_DOWNLOAD_LOCATION}/.yarnrc"

[ ! -d "~/.config" ] && pwsh "New-Item -Item-Type SymbolicLink -Path ~/.config -Target ${CONFIG_DOWNLOAD_LOCATION}/.config"
echo "Finished creating symbolic links for the configuration files..."
