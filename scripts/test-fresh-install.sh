#!/bin/bash
# scripts/test-fresh-install.sh
# Fresh install test harness — host-side driver.
#
# Builds the agents-observe server image, saves it to a tarball, builds
# the test container, and runs the test container with the tarball
# mounted. The test container starts a nested dockerd, loads the tarball,
# runs the real claude CLI against the plugin, and verifies the fresh
# install startup path end-to-end.
#
# Required env:
#   AGENTS_OBSERVE_TEST_CLAUDE_OAUTH_TOKEN — OAuth token for the claude CLI
#   (can be set in .env at the repo root — this script sources it)
#
# Usage:
#   ./scripts/test-fresh-install.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP_DIR="$REPO_ROOT/.tmp"
cd "$REPO_ROOT"

# --- Source .env if present --------------------------------------------
if [ -f "$REPO_ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$REPO_ROOT/.env"
  set +a
fi

# --- Preflight ---------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker not found on PATH" >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "ERROR: docker daemon is not responsive" >&2
  echo "       Start Docker Desktop (or equivalent) and try again." >&2
  exit 1
fi

if [ -z "${AGENTS_OBSERVE_TEST_CLAUDE_OAUTH_TOKEN:-}" ]; then
  echo "ERROR: AGENTS_OBSERVE_TEST_CLAUDE_OAUTH_TOKEN is not set" >&2
  echo "" >&2
  echo "This env var holds the OAuth token used to authenticate the claude" >&2
  echo "CLI inside the test container. Set it in .env (gitignored) or" >&2
  echo "export it in your shell:" >&2
  echo "  export AGENTS_OBSERVE_TEST_CLAUDE_OAUTH_TOKEN=sk-ant-oat-..." >&2
  exit 1
fi

# --- Tarball path ------------------------------------------------------
# Docker Desktop on macOS can only bind-mount from certain paths (typically
# under /Users/). Using a subdir of the repo ensures the mount works.
mkdir -p "$TMP_DIR"
TARBALL="$TMP_DIR/agents-observe-server-image.tar"
trap 'rm "$TARBALL"' EXIT

# --- Build server image ------------------------------------------------
echo ""
echo "=== [1/4] Building server image (agents-observe:local) ==="
docker build -t agents-observe:local .

# --- Save server image to tarball --------------------------------------
echo ""
echo "=== [2/4] Saving server image to tarball ==="
docker save agents-observe:local -o "$TARBALL"
echo "Tarball: $TARBALL ($(du -h "$TARBALL" | cut -f1))"

# --- Build test container image ----------------------------------------
echo ""
echo "=== [3/4] Building test container image (agents-observe-test:local) ==="
docker build -t agents-observe-test:local -f test/fresh-install/Dockerfile .

# --- Run test container ------------------------------------------------
echo ""
echo "=== [4/4] Running test container ==="
set +e
docker run \
  --privileged \
  --rm \
  -v "$TARBALL:/server-image.tar:ro" \
  -e "CLAUDE_CODE_OAUTH_TOKEN=$AGENTS_OBSERVE_TEST_CLAUDE_OAUTH_TOKEN" \
  -e "AGENTS_OBSERVE_LOG_LEVEL=trace" \
  agents-observe-test:local
EXIT_CODE=$?
set -e

echo ""
echo "=== test-fresh-install exited with code $EXIT_CODE ==="
exit $EXIT_CODE
