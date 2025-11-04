#!/bin/bash

CONFIG_DOWNLOAD_LOCATION=$(pwd)

detect_os() {
  local os_type
  local is_wsl=false

  # First, detect the main OS type using uname
  case "$(uname -s)" in
    Linux*)
      os_type="linux"
      # Check if it's WSL specifically
      if grep -qi WSL2 /proc/sys/kernel/osrelease 2>/dev/null; then
        if grep -qi arch /etc/os-release 2>/dev/null; then
          is_wsl=true
          os_type="arch-wsl"
        fi
      elif grep -qi wsl /proc/sys/kernel/osrelease 2>/dev/null; then
        is_wsl=true
        os_type="wsl"
      fi
      ;;
    Darwin*)
      os_type="macOS"
      ;;
    CYGWIN*|MINGW*|MSYS*)
      os_type="win"
      ;;
    *)
      os_type="Unknown"
      ;;
  esac

  echo "$os_type"
}

# Usage
OS=$(detect_os)
echo "Detected OS: $OS"

# You can also do conditional logic
if [[ "$OS" == "wsl" ]]; then
  echo "Running on WSL"
elif [[ "$OS" == "arch-wsl" ]]; then
  echo "Running on Arch in WSL environment"
  echo "Started Creating Symbolic Link for Config"
  rm -rf ~/.config
  ln -s "$CONFIG_DOWNLOAD_LOCATION/.config" ~/.config
  ln -s "$CONFIG_DOWNLOAD_LOCATION/.bashrc" ~/.bashrc 
  ln -s "$CONFIG_DOWNLOAD_LOCATION/.bash_profile" ~/.bash_profile
  ln -s "$CONFIG_DOWNLOAD_LOCATION/.npmrc" ~/.npmrc
  ln -s "$CONFIG_DOWNLOAD_LOCATION/.condarc" ~/.condarc
  ln -s "$CONFIG_DOWNLOAD_LOCATION/.yarnrc" ~/.yarnrc
  echo "Finished Creating Symbolic Link"
elif [[ "$OS" == "linux" ]]; then
  echo "Running on native Linux"
elif [[ "$OS" == "macOS" ]]; then
  echo "Running on macOS"
  echo "Started Creating Symbolic Link for Config"
  rm -rf ~/.config
  ln -s "$CONFIG_DOWNLOAD_LOCATION/.config" ~/.config
  ln -s "$CONFIG_DOWNLOAD_LOCATION/.bashrc" ~/.bashrc
  ln -s "$CONFIG_DOWNLOAD_LOCATION/.bash_profile" ~/.bash_profile
  ln -s "$CONFIG_DOWNLOAD_LOCATION/.npmrc" ~/.npmrc
  ln -s "$CONFIG_DOWNLOAD_LOCATION/.condarc" ~/.condarc
  ln -s "$CONFIG_DOWNLOAD_LOCATION/.yarnrc" ~/.yarnrc
  echo "Finished Creating Symbolic Link"
elif [[ "$OS" == "win" ]]; then
  echo "Running on Windows"
  source ./install-win.sh
fi
