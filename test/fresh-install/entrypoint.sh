#!/bin/bash
# Fresh install test harness — entrypoint (runs inside test container)
# Starts inner dockerd, loads pre-built server image, runs claude against
# the plugin, runs verification checks, and prints a full diagnostic dump.

set -uo pipefail

echo "=== Fresh install test harness — entrypoint starting ==="
echo "Container: $(hostname)"
echo "Date: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo ""

# --- Start inner dockerd -----------------------------------------------
echo "=== Starting inner dockerd ==="
dockerd-entrypoint.sh >/var/log/dockerd.log 2>&1 &
DOCKERD_PID=$!

echo "Waiting for dockerd (pid $DOCKERD_PID) to become responsive..."
for i in $(seq 1 60); do
  if docker info >/dev/null 2>&1; then
    echo "dockerd is up after ${i}s"
    break
  fi
  sleep 1
done

if ! docker info >/dev/null 2>&1; then
  echo "FATAL: dockerd did not become responsive within 60 seconds"
  echo ""
  echo "--- /var/log/dockerd.log (tail) ---"
  tail -n 50 /var/log/dockerd.log || true
  exit 1
fi
echo ""

# --- Load pre-built server image from tarball --------------------------
echo "=== Loading server image from tarball ==="
if [ ! -f /server-image.tar ]; then
  echo "FATAL: /server-image.tar not found (the driver script must mount it)"
  exit 1
fi

docker load -i /server-image.tar
echo ""

if ! docker images --format '{{.Repository}}:{{.Tag}}' | grep -q '^agents-observe:local$'; then
  echo "FATAL: agents-observe:local not present in inner dockerd after load"
  docker images
  exit 1
fi
echo "Server image loaded successfully"
echo ""

# --- Configure plugin to use loaded image ------------------------------
export AGENTS_OBSERVE_DOCKER_IMAGE=agents-observe:local
export AGENTS_OBSERVE_TEST_SKIP_PULL=1
echo "AGENTS_OBSERVE_DOCKER_IMAGE=$AGENTS_OBSERVE_DOCKER_IMAGE"
echo "AGENTS_OBSERVE_TEST_SKIP_PULL=$AGENTS_OBSERVE_TEST_SKIP_PULL"
echo ""

# --- Set CLAUDE_PLUGIN_ROOT for MCP config resolution --------------------
# --plugin-dir loads hooks but NOT .mcp.json. We use --mcp-config to
# load the plugin's REAL .mcp.json. That file uses ${CLAUDE_PLUGIN_ROOT}
# which Claude normally sets for installed plugins but not for --mcp-config.
# Setting it here lets the .mcp.json resolve paths correctly.
export CLAUDE_PLUGIN_ROOT=/plugin
echo "CLAUDE_PLUGIN_ROOT=$CLAUDE_PLUGIN_ROOT"
echo ""

# --- Run claude against the plugin -------------------------------------
echo "=== Running claude -p ... ==="
CLAUDE_STDOUT=/tmp/claude.stdout
CLAUDE_STDERR=/tmp/claude.stderr
set +e
claude \
  --plugin-dir /plugin \
  --mcp-config /plugin/.mcp.json \
  --permission-mode bypassPermissions \
  -p "/observe status" \
  >"$CLAUDE_STDOUT" 2>"$CLAUDE_STDERR"
CLAUDE_EXIT=$?
# Do NOT restore set -e here — the rest of the script (verification +
# diagnostic dump) must tolerate individual command failures.

echo "claude exit code: $CLAUDE_EXIT"
echo ""

# --- Verification phase -------------------------------------------------
echo "=== Running verification checks ==="
CHECK_1_RESULT="FAIL"; CHECK_1_DETAIL=""
CHECK_2_RESULT="FAIL"; CHECK_2_DETAIL=""
CHECK_3_RESULT="FAIL"; CHECK_3_DETAIL=""
CHECK_4_MCP_COUNT=0
CHECK_4_CLI_COUNT=0

# Check 1: inner agents-observe container exists and is running
CONTAINER_STATUS="$(docker ps -a --filter name=agents-observe --format '{{.Status}}' | head -1)"
if [ -n "$CONTAINER_STATUS" ] && echo "$CONTAINER_STATUS" | grep -qi '^up'; then
  CHECK_1_RESULT="PASS"
  CHECK_1_DETAIL="$CONTAINER_STATUS"
else
  CHECK_1_DETAIL="status='$CONTAINER_STATUS' (expected 'Up ...')"
fi

# Check 2: server health endpoint returns 200 with ok:true
HEALTH_BODY="$(curl -sf http://127.0.0.1:4981/api/health 2>/tmp/curl-health.err || true)"
if [ -n "$HEALTH_BODY" ] && echo "$HEALTH_BODY" | jq -e '.ok == true' >/dev/null 2>&1; then
  CHECK_2_RESULT="PASS"
  CHECK_2_DETAIL="$(echo "$HEALTH_BODY" | jq -c '{ok, version, runtime}')"
else
  CHECK_2_DETAIL="body='$HEALTH_BODY' curl-err='$(cat /tmp/curl-health.err 2>/dev/null || true)'"
fi

# Check 3: at least one session with at least one event captured
SESSIONS_BODY="$(curl -sf http://127.0.0.1:4981/api/sessions/recent 2>/tmp/curl-sessions.err || true)"
if [ -n "$SESSIONS_BODY" ]; then
  SESSION_COUNT="$(echo "$SESSIONS_BODY" | jq 'if type == "array" then length elif .sessions then (.sessions | length) else 0 end' 2>/dev/null || echo 0)"
  if [ "${SESSION_COUNT:-0}" -gt 0 ]; then
    CHECK_3_RESULT="PASS"
    CHECK_3_DETAIL="session_count=$SESSION_COUNT"
  else
    CHECK_3_DETAIL="session_count=0 (expected >=1) body='$(echo "$SESSIONS_BODY" | head -c 200)'"
  fi
else
  CHECK_3_DETAIL="empty response curl-err='$(cat /tmp/curl-sessions.err 2>/dev/null || true)'"
fi

# Check 4 (soft): grep ERROR lines in mcp.log and cli.log
MCP_LOG_FILES="$(find / -type f -name 'mcp.log' 2>/dev/null)"
CLI_LOG_FILES="$(find / -type f -name 'cli.log' 2>/dev/null)"
if [ -n "$MCP_LOG_FILES" ]; then
  CHECK_4_MCP_COUNT="$(grep -c 'ERROR' $MCP_LOG_FILES 2>/dev/null | awk -F: '{s+=$NF} END {print s+0}')"
fi
if [ -n "$CLI_LOG_FILES" ]; then
  CHECK_4_CLI_COUNT="$(grep -c 'ERROR' $CLI_LOG_FILES 2>/dev/null | awk -F: '{s+=$NF} END {print s+0}')"
fi

# --- Unconditional diagnostic dump -------------------------------------
echo ""
echo "=============================================="
echo "=== DIAGNOSTIC BUNDLE (always printed)     ==="
echo "=============================================="
echo ""
echo "=== claude invocation ==="
echo "exit code: $CLAUDE_EXIT"
echo ""
echo "--- claude stdout ---"
cat "$CLAUDE_STDOUT" 2>/dev/null || echo "(file not found)"
echo ""
echo "--- claude stderr ---"
cat "$CLAUDE_STDERR" 2>/dev/null || echo "(file not found)"
echo ""

echo "=== docker state (inside test container) ==="
echo "--- docker ps -a ---"
docker ps -a
echo ""
echo "--- docker images ---"
docker images
echo ""

echo "=== docker logs agents-observe (inner server container) ==="
if docker ps -a --format '{{.Names}}' | grep -q '^agents-observe$'; then
  docker logs agents-observe 2>&1 || true
else
  echo "(agents-observe container not present)"
fi
echo ""

echo "=== mcp.log ==="
if [ -n "$MCP_LOG_FILES" ]; then
  for f in $MCP_LOG_FILES; do
    echo "--- $f ---"
    cat "$f" || true
  done
else
  echo "(no mcp.log files found)"
fi
echo ""

echo "=== cli.log ==="
if [ -n "$CLI_LOG_FILES" ]; then
  for f in $CLI_LOG_FILES; do
    echo "--- $f ---"
    cat "$f" || true
  done
else
  echo "(no cli.log files found)"
fi
echo ""

echo "=== verification results ==="
echo "1. Inner container exists: $CHECK_1_RESULT — $CHECK_1_DETAIL"
echo "2. Server health:          $CHECK_2_RESULT — $CHECK_2_DETAIL"
echo "3. Events captured:        $CHECK_3_RESULT — $CHECK_3_DETAIL"
echo "4. mcp.log ERROR lines:    $CHECK_4_MCP_COUNT"
echo "4. cli.log ERROR lines:    $CHECK_4_CLI_COUNT"

# Check 5 (soft): UI HTML loads and references valid assets
CHECK_5_RESULT="SKIP"
CHECK_5_DETAIL=""
UI_HTML="$(curl -sf http://127.0.0.1:4981/ 2>/dev/null || true)"
if [ -n "$UI_HTML" ]; then
  if echo "$UI_HTML" | grep -q '<div id="root">' && echo "$UI_HTML" | grep -q '<script'; then
    # Verify JS assets are reachable
    ASSET_URLS="$(echo "$UI_HTML" | grep -oE '(src|href)="/assets/[^"]+' | sed 's/^[^"]*"//' || true)"
    ASSETS_OK=true
    for asset in $ASSET_URLS; do
      if ! curl -sf "http://127.0.0.1:4981${asset}" -o /dev/null 2>/dev/null; then
        ASSETS_OK=false
        CHECK_5_DETAIL="missing asset: $asset"
        break
      fi
    done
    if $ASSETS_OK; then
      CHECK_5_RESULT="PASS"
      CHECK_5_DETAIL="HTML + $(echo "$ASSET_URLS" | wc -w | tr -d ' ') assets OK"
    else
      CHECK_5_RESULT="FAIL"
    fi
  else
    CHECK_5_RESULT="FAIL"
    CHECK_5_DETAIL="HTML missing root div or script tag"
  fi
else
  CHECK_5_DETAIL="curl to / returned empty"
fi
echo "5. UI assets reachable:    $CHECK_5_RESULT — $CHECK_5_DETAIL"
echo ""

# --- Final status ------------------------------------------------------
if [ "$CHECK_1_RESULT" = "PASS" ] && [ "$CHECK_2_RESULT" = "PASS" ] && [ "$CHECK_3_RESULT" = "PASS" ]; then
  FINAL_STATUS="PASS"
else
  FINAL_STATUS="FAIL"
fi

echo "=== final status: $FINAL_STATUS ==="
echo "[CHECKS_DONE]"

# Keep alive if requested (for manual UI verification from host)
if [ "${AGENTS_OBSERVE_TEST_KEEP_ALIVE:-}" = "1" ] && [ "$FINAL_STATUS" = "PASS" ]; then
  echo "Container staying alive for manual UI check. Kill to exit."
  sleep infinity
fi

if [ "$FINAL_STATUS" = "PASS" ]; then
  exit 0
else
  exit 1
fi
