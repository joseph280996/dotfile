#!/usr/bin/env fish

set CONFIG_DOWNLOAD_LOCATION $(pwd)

echo "Started Installing Configurations"

echo "Started Detecting OS Type..."
set uname_output (uname)

switch $uname_output
case "Linux"
  # Check for WSL using multiple methods
  if test -f /proc/sys/kernel/osrelease; and grep -qi wsl /proc/sys/kernel/osrelease 2>/dev/null
    if grep -qi arch /etc/os-release 2>/dev/null
      echo "Arch WSL Detected..."
      if test ! -d "~/.config" 
        echo ".config folder does not exist!"
        echo "Started Linking .config Folder..."
        ln -s "$CONFIG_DOWNLOAD_LOCATION/.config" ~/.config
        echo "Finished Linking .config Folder..."
      end
    else
      echo "Linux WSL Environment Detected..."
      if test ! -d "~/.config" 
        echo ".config folder does not exist!"
        echo "Started Linking .config Folder"
        ln -s "$CONFIG_DOWNLOAD_LOCATION/.config" ~/.config
        echo "Finished Linking .config Folder"
      end
    end
  else if test -f /etc/os-release; and grep -q arch /etc/os-release 2>/dev/null
    echo "Arch Linux Detected..."
    if test ! -d "~/.config" 
      echo ".config folder does not exist!"
      echo "Started Linking .config Folder"
      ln -s "$CONFIG_DOWNLOAD_LOCATION/.config" ~/.config
      echo "Finished Linking .config Folder"
    end
  else
    echo "Linux Detected..."
    if test ! -d "~/.config" 
      echo ".config folder does not exist!"
      echo "Started Linking .config Folder"
      ln -s "$CONFIG_DOWNLOAD_LOCATION/.config" ~/.config
      echo "Finished Linking .config Folder"
    end
  end
case "Darwin"
  echo "MacOS Detected..."
  if test ! -d "~/.config" 
    echo ".config folder does not exist!"
    echo "Started Linking .config Folder"
    ln -s "$CONFIG_DOWNLOAD_LOCATION/.config" ~/.config 
    echo "Finished Linking .config Folder"
  end

case "*"
  # Fish is not supported on Windows
  echo "unknown"
end
