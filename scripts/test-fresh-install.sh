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
#   ./scripts/test-fresh-install.sh [--skip-build] [--skip-ui-check]
#
# Flags:
#   --skip-build     Skip building the server image (reuse agents-observe:local).
#                    Useful when called from release.sh which already built it.
#   --skip-ui-check  Skip the manual UI verification step.

set -euo pipefail

SKIP_BUILD=false
SKIP_UI_CHECK=false
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=true ;;
    --skip-ui-check) SKIP_UI_CHECK=true ;;
  esac
done

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
CONTAINER_NAME="agents-observe-fresh-install-test"
UI_PORT=4998

mkdir -p "$TMP_DIR"
TARBALL="$TMP_DIR/agents-observe-server-image.tar"
trap 'docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1; rm -f "$TARBALL"' EXIT

# --- Build server image ------------------------------------------------
if $SKIP_BUILD; then
  echo ""
  echo "=== [1/4] Skipping server image build (--skip-build) ==="
  if ! docker image inspect agents-observe:local >/dev/null 2>&1; then
    echo "Error: agents-observe:local image not found. Cannot use --skip-build." >&2
    exit 1
  fi
else
  echo ""
  echo "=== [1/4] Building server image (agents-observe:local) ==="
  docker build -t agents-observe:local .
fi

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

# Determine if we need keep-alive for UI check
KEEP_ALIVE="0"
if ! $SKIP_UI_CHECK; then
  KEEP_ALIVE="1"
fi

# Remove any leftover container from a previous run
docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true

# Run detached so we can poll logs and keep it alive for UI check
docker run -d \
  --privileged \
  --name "$CONTAINER_NAME" \
  -p "${UI_PORT}:4981" \
  -v "$TARBALL:/server-image.tar:ro" \
  -e "CLAUDE_CODE_OAUTH_TOKEN=$AGENTS_OBSERVE_TEST_CLAUDE_OAUTH_TOKEN" \
  -e "AGENTS_OBSERVE_LOG_LEVEL=trace" \
  -e "AGENTS_OBSERVE_TEST_KEEP_ALIVE=$KEEP_ALIVE" \
  agents-observe-test:local

# Stream logs and wait for [CHECKS_DONE] marker
echo ""
echo "Waiting for automated checks to complete..."
while true; do
  if docker logs "$CONTAINER_NAME" 2>&1 | grep -q '\[CHECKS_DONE\]'; then
    break
  fi
  # If container exited (checks failed), break
  if [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null)" != "true" ]; then
    break
  fi
  sleep 1
done

# Print the full logs
echo ""
docker logs "$CONTAINER_NAME" 2>&1

# Get the automated check result
FINAL_LINE="$(docker logs "$CONTAINER_NAME" 2>&1 | grep '=== final status:' | tail -1)"
if echo "$FINAL_LINE" | grep -q 'PASS'; then
  AUTO_EXIT=0
else
  AUTO_EXIT=1
fi

# --- Manual UI check (if automated checks passed) --------------------
if [ $AUTO_EXIT -eq 0 ] && ! $SKIP_UI_CHECK; then
  echo ""
  echo "=============================================="
  echo "=== Manual UI Check                        ==="
  echo "=============================================="
  echo ""
  echo "Dashboard is running at: http://localhost:${UI_PORT}"
  echo ""

  # Open browser (macOS)
  if command -v open >/dev/null 2>&1; then
    open "http://localhost:${UI_PORT}"
  fi

  echo "Please verify:"
  echo "  1. Dashboard loads without errors"
  echo "  2. Session appears in the sidebar"
  echo "  3. Events are visible in the stream"
  echo ""
  read -r -p "Does the UI look correct? [Y/n] " UI_CONFIRM
  if [ "${UI_CONFIRM,,}" = "n" ]; then
    echo "UI check failed by user."
    AUTO_EXIT=1
  else
    echo "UI check passed."
  fi
fi

echo ""
echo "=== test-fresh-install exited with code $AUTO_EXIT ==="
exit $AUTO_EXIT
