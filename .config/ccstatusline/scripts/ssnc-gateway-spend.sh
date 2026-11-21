#!/bin/sh
# Prints SS&C gateway monthly data. Modes: (no arg) spend vs cap, e.g.
# "$227.78/$500 (46%)"; "eom" month-end projection, e.g. "projected $545 EOM"
# (MTD spend / day-of-month * days in month). Both modes share one cache file.
# Data source: governance API used by ssnc-token-monitor-tray.
# Exits non-zero on failure so ccstatusline shows [Exit: N] instead of stale data.

umask 077  # cache holds user info; keep it private even on shared /tmp

CACHE_DIR="${TMPDIR:-/tmp}/ssnc-gateway-spend"
CACHE_FILE="$CACHE_DIR/spend.json"
CACHE_TTL_MIN=1  # minutes; ccstatusline custom-command cache also caps at 60s

API_URL="$AI_PORTAL/self_service/dashboard"
SECRET_FILE="$HOME/.config/fish/conf.d/secret.fish"
body=

# Token precedence: env var, then secret.fish via sed
if [ -n "$ANTHROPIC_AUTH_TOKEN" ]; then
  TOKEN="$ANTHROPIC_AUTH_TOKEN"
elif [ -f "$SECRET_FILE" ]; then
  # token never appears in ps/argv: single-quoted sed program, no $TOKEN interpolation
  TOKEN=$(sed -n 's/^set -gx ANTHROPIC_AUTH_TOKEN "\(.*\)"$/\1/p' "$SECRET_FILE" | head -1)
fi

if [ -z "$TOKEN" ]; then
  exit 1
fi

parse_body() {
  if command -v jq >/dev/null 2>&1; then
    spent=$(printf '%s' "$body" | jq -r '.spend.spent_cents // empty' 2>/dev/null)
    limit=$(printf '%s' "$body" | jq -r '.spend.monthly_limit_cents // empty' 2>/dev/null)
  else
    spent=$(printf '%s' "$body" | sed -n 's/.*"spent_cents": *\([0-9]*\).*/\1/p' | head -1)
    limit=$(printf '%s' "$body" | sed -n 's/.*"monthly_limit_cents": *\([0-9]*\).*/\1/p' | head -1)
  fi
  case $spent in ''|*[!0-9]*) return 1 ;; esac
  case $limit in ''|*[!0-9]*) return 1 ;; esac
  [ "$limit" -gt 0 ] || return 1
}

# find -mmin is portable across macOS/Linux stat variants
if [ -f "$CACHE_FILE" ] && [ -n "$(find "$CACHE_FILE" -mmin -"$CACHE_TTL_MIN" 2>/dev/null)" ]; then
  body=$(cat "$CACHE_FILE")
fi

fetched=0
if ! { [ -n "$body" ] && parse_body; }; then
  # Bad or missing cache: fetch. -K - passes the header via stdin so the
  # token never shows in ps/argv.
  body=$(printf 'header = "x-api-key: %s"\n' "$TOKEN" | curl -sf -m 5 -K - -H "Accept: application/json" "$API_URL") || exit 1
  fetched=1
  parse_body || exit 1
fi

# Write only after a real fetch: rewriting on a cache hit would refresh the
# mtime and the cache would never expire
if [ "$fetched" -eq 1 ]; then
  mkdir -p "$CACHE_DIR" && printf '%s' "$body" > "$CACHE_FILE.$$" && mv "$CACHE_FILE.$$" "$CACHE_FILE"
fi

spent_usd=$(awk "BEGIN {printf \"%.2f\", $spent/100}")
limit_usd=$(awk "BEGIN {printf \"%.0f\", $limit/100}")
pct=$(awk "BEGIN {printf \"%d\", $spent*100/$limit}")

# Month-end projection: MTD spend / day-of-month * days in month (BSD date,
# GNU date fallback; omit the projection if either is not a positive integer)
days_elapsed=$(date +%e | tr -d ' ')
last_day=$(date -v1d -v+1m -v-1d +%d 2>/dev/null || date -d "$(date +%Y-%m-01) +1 month -1 day" +%d 2>/dev/null)
last_day=$(printf '%s' "$last_day" | sed 's/^0*//')
proj=
case $days_elapsed in ''|*[!0-9]*|0) ;; *)
  case $last_day in ''|*[!0-9]*) ;;
    *) proj=$(awk "BEGIN {printf \"%.0f\", $spent*$last_day/$days_elapsed/100}") ;;
  esac ;;
esac

# Effective pct drives color: current MTD, or the EOM projection in eom mode
if [ "$1" = "eom" ]; then
  [ -n "$proj" ] || exit 1  # date math failed: no projection to show
  out="proj. \$$proj EOM"
  eff_pct=$(awk "BEGIN {printf \"%d\", $spent*$last_day/$days_elapsed*100/$limit}")
else
  out=$(printf '$%s/$%s (%s%%)' "$spent_usd" "$limit_usd" "$pct")
  eff_pct=$pct
fi

# Kanagawa thresholds: >=90 error (E46876), >=70 warning (DCA561), else
# springGreen (98BB6C). Requires preserveColors on the widget.
if [ "$eff_pct" -ge 90 ]; then
  rgb="228;104;118"
elif [ "$eff_pct" -ge 70 ]; then
  rgb="220;165;97"
else
  rgb="152;187;108"
fi
printf '\033[38;2;%sm%s\033[0m' "$rgb" "$out"
