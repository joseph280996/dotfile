#!/usr/bin/env bash
# run_query.sh — Run a splunk_query.py command, prompting for credentials if needed.
#
# Usage:
#   bash run_query.sh [splunk_query.py args...]
#
# RECOMMENDED: Configure credentials via keyring first:
#   python3 scripts/setup.py
#
# If ~/.copilot/skills/eclipse-splunk-investigation/.env exists it is sourced automatically
# as a fallback. Otherwise, if SPLUNK_* env vars are not set, you will be prompted.

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SKILL_DIR/.env"

# Source .env if present
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

# Prompt for any missing vars
if [[ -z "$SPLUNK_HOST" ]]; then
  read -rp "SPLUNK_HOST: " SPLUNK_HOST
  export SPLUNK_HOST
fi
if [[ -z "$SPLUNK_USERNAME" ]]; then
  read -rp "SPLUNK_USERNAME: " SPLUNK_USERNAME
  export SPLUNK_USERNAME
fi
if [[ -z "$SPLUNK_PASSWORD" ]]; then
  read -rsp "SPLUNK_PASSWORD: " SPLUNK_PASSWORD
  echo
  export SPLUNK_PASSWORD
fi

# Offer to save credentials (keyring recommended, .env as fallback)
if [[ ! -f "$ENV_FILE" ]]; then
  echo ""
  echo "RECOMMENDED: Store credentials securely in OS keyring:"
  echo "  python3 $SKILL_DIR/scripts/setup.py"
  echo ""
  read -rp "Or save to $ENV_FILE (less secure, but backwards compatible)? [y/N] " _save
  if [[ "$_save" =~ ^[Yy]$ ]]; then
    cat > "$ENV_FILE" <<EOF
SPLUNK_HOST=$SPLUNK_HOST
SPLUNK_USERNAME=$SPLUNK_USERNAME
SPLUNK_PASSWORD=$SPLUNK_PASSWORD
EOF
    chmod 600 "$ENV_FILE"
    echo "Saved to $ENV_FILE"
  fi
fi

exec python3 "$SKILL_DIR/scripts/splunk_query.py" "$@"
