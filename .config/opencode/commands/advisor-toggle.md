---
name: advisor-toggle
description: "Turn the automatic advisor consults on or off"
---

# Advisor Toggle

Toggle whether the advisor is consulted automatically at decision points.

The switch is a sentinel file: `~/.local/share/opencode/advisor-disabled`.

- **Present** → automatic consults are OFF.
- **Absent** → automatic consults are ON (the default).

It lives under `~/.local/share/opencode/` deliberately — **not** in the opencode
config directory, which is a git repository where a sentinel would show up as a
dirty file on every status check.

## What to do

1. Check the current state:

   ```bash
   test -f ~/.local/share/opencode/advisor-disabled && echo OFF || echo ON
   ```

2. Flip it, honouring any argument the user passed (`on`, `off`, or nothing to
   toggle):

   ```bash
   # turn OFF
   mkdir -p ~/.local/share/opencode && touch ~/.local/share/opencode/advisor-disabled

   # turn ON
   rm -f ~/.local/share/opencode/advisor-disabled
   ```

3. Report the new state in one line, e.g. `Automatic advisor consults: OFF`.

## Scope

Turning it off suppresses **automatic** consults only. An explicit `@advisor`
request from the user always works regardless of the sentinel — the toggle
governs your judgment-based and hook-driven consults, not the user's direct
requests.
