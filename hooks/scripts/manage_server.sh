#!/usr/bin/env bash
# MCP stdio server for Claude Observe plugin.
# Starts the Docker container via the CLI, then stays alive for MCP.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

node "$SCRIPT_DIR/observe_cli.mjs" server start || {
  echo "[claude-observe] Server start failed" >&2
  exit 1
}

# Stay alive as MCP stdio server.
# The Docker container runs independently and persists after this exits.
cat >/dev/null 2>&1 || true
