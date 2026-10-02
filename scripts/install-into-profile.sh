#!/usr/bin/env bash
# Install this plugin into a dsh profile whose CLI is owned by another surface
# (the desktop profile belongs to the Electron app, so `dsh plugin --profile
# desktop` refuses to run). This script does what that command would have done:
#
#   1. links the plugin package into <profile>/node_modules (pnpm add link:…);
#   2. appends the package to `dsh.profile.bundles` in <profile>/package.json.
#
# Idempotent. A `.bak` copy of package.json is written before the first change.
#
#   bash scripts/install-into-profile.sh desktop
#   bash scripts/install-into-profile.sh desktop --dry-run
set -euo pipefail

PROFILE="${1:-}"
shift || true
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

if [ -z "$PROFILE" ]; then
  echo "usage: bash scripts/install-into-profile.sh <profile> [--dry-run]" >&2
  exit 2
fi

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PKG_NAME="$(node -p "require('$PLUGIN_DIR/package.json').name")"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILE_DIR="$DSH_HOME/profiles/$PROFILE"
PKG_JSON="$PROFILE_DIR/package.json"

echo "plugin    : $PKG_NAME"
echo "plugin dir: $PLUGIN_DIR"
echo "profile   : $PROFILE_DIR"

[ -d "$PROFILE_DIR" ] || { echo "no such profile directory: $PROFILE_DIR" >&2; exit 1; }
[ -f "$PKG_JSON" ] || { echo "no package.json in $PROFILE_DIR" >&2; exit 1; }

# --- 1. link the package into the profile's node_modules -----------------------
RUNTIME="$DSH_HOME/dsh-runtimes/dsh-primary-runtime/dependencies"
PNPM_BIN=""
if command -v pnpm >/dev/null 2>&1; then
  PNPM_BIN="$(command -v pnpm)"
elif [ -x "$RUNTIME/node/bin/node" ] && [ -f "$RUNTIME/pnpm/bin/pnpm.mjs" ]; then
  mkdir -p "$RUNTIME"
  PNPM_BIN="$RUNTIME/pnpm-shim"
  printf '#!/bin/sh\nexec "%s/node/bin/node" "%s/pnpm/bin/pnpm.mjs" "$@"\n' "$RUNTIME" "$RUNTIME" > "$PNPM_BIN"
  chmod +x "$PNPM_BIN"
else
  echo "pnpm not found on PATH and no bundled runtime at $RUNTIME" >&2
  exit 1
fi
echo "pnpm      : $PNPM_BIN"

LINKED=0
if [ -e "$PROFILE_DIR/node_modules/$PKG_NAME" ]; then
  echo "link      : already present"
  LINKED=1
fi

if [ "$LINKED" = "0" ]; then
  if [ "$DRY_RUN" = "1" ]; then
    echo "link      : would run (cd $PROFILE_DIR && pnpm add link:$PLUGIN_DIR)"
  else
    (cd "$PROFILE_DIR" && "$PNPM_BIN" add "link:$PLUGIN_DIR") >/dev/null
    echo "link      : created"
  fi
fi

# --- 2. append to dsh.profile.bundles -----------------------------------------
if [ "$DRY_RUN" = "1" ]; then
  node "$PLUGIN_DIR/scripts/append-bundle.mjs" "$PKG_JSON" "$PKG_NAME" --dry-run
  exit 0
fi

node "$PLUGIN_DIR/scripts/append-bundle.mjs" "$PKG_JSON" "$PKG_NAME"

echo
echo "restart the $PROFILE profile (or the app that owns it) to activate the bundle."
