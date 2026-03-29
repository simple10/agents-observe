#!/usr/bin/env bash
# MCP stdio server for Claude Observe plugin.
# Starts the Docker container via the CLI, then stays alive for MCP.
# On exit (MCP shutdown), stops the container and cleans up.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cleanup() {
  node "$SCRIPT_DIR/observe_cli.mjs" server stop >/dev/null 2>&1 || true
}
trap cleanup EXIT TERM INT

node "$SCRIPT_DIR/observe_cli.mjs" server start || {
  echo "[claude-observe] Server start failed" >&2
  exit 1
}

# Stay alive as MCP stdio server.
cat >/dev/null 2>&1 || true
