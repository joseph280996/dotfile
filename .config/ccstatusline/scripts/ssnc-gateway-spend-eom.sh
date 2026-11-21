#!/bin/sh
# ccstatusline wrapper eom mode; shares the 1-min cache with the base script.
# Resolve sibling relative to this script: $0, not CWD (callers run from anywhere).
exec "/Users/tpham4/.config/ccstatusline/scripts/ssnc-gateway-spend.sh" eom
