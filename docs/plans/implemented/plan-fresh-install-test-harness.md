# Fresh Install Test Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a nested-Docker harness that runs the real `claude` CLI against the agents-observe plugin in a pristine environment, verifying the fresh-install startup path end-to-end and dumping a full diagnostic bundle on every run.

**Architecture:** A host-side shell driver (`scripts/test-fresh-install.sh`) builds the server image, saves it to a tarball, builds a `docker:dind`-based test image containing Node and the `claude` CLI, then runs the test container with `--privileged` so its inner dockerd can host a sibling agents-observe server container. The test container's entrypoint loads the tarball, invokes `claude --plugin-dir /plugin -p "..."`, runs four verification checks against the started server, and prints all captured logs. One narrow production-code change (`AGENTS_OBSERVE_TEST_SKIP_PULL=1`) lets `startServer()` skip its `docker pull` step when the image is pre-loaded.

**Tech Stack:** Bash, Docker (host) + `docker:dind` (inner daemon), Node.js 24, `@anthropic-ai/claude-code` npm package, Vitest (for the one unit test covering the new config field), `curl` + `jq` (verification inside the container). Reference the companion design spec at `docs/plans/_queued/spec-fresh-install-test-harness.md` for the full rationale.

---

## File Structure

**New files:**
- `scripts/test-fresh-install.sh` — host-side driver script (single entrypoint for humans)
- `test/fresh-install/Dockerfile` — test container image definition
- `test/fresh-install/entrypoint.sh` — orchestrates dockerd + claude + verification + diagnostics inside the container
- `test/fresh-install/README.md` — short doc covering usage, env vars, and gotchas
- `.dockerignore` — excludes build artifacts from the test image's build context

**Modified files:**
- `hooks/scripts/lib/config.mjs` — add `testSkipPull: boolean` field derived from `AGENTS_OBSERVE_TEST_SKIP_PULL`
- `test/config.test.mjs` — add two tests covering the new config field and extend `envKeys` snapshot list
- `hooks/scripts/lib/docker.mjs` — honor `config.testSkipPull` in `startServer()` (skip the `docker pull` step)

Responsibility split: `config.mjs` is the single source of truth for env var reads (per existing project convention); `docker.mjs` consumes the resolved config; the test container is entirely self-contained under `test/fresh-install/`; the driver script lives in `scripts/` to stay out of the way of `justfile`.

---

## Task 1: Add `testSkipPull` field to config (TDD)

**Files:**
- Modify: `test/config.test.mjs`
- Modify: `hooks/scripts/lib/config.mjs`

- [ ] **Step 1: Add the new env var to the snapshot list in the test file**

Open `test/config.test.mjs`. Find the `envKeys` array (lines 5–15) and add `'AGENTS_OBSERVE_TEST_SKIP_PULL'` to it so tests that set this variable don't leak into other tests.

```javascript
const envKeys = [
  'CLAUDE_PLUGIN_DATA',
  'AGENTS_OBSERVE_SERVER_PORT',
  'AGENTS_OBSERVE_API_BASE_URL',
  'AGENTS_OBSERVE_PROJECT_SLUG',
  'AGENTS_OBSERVE_DOCKER_CONTAINER_NAME',
  'AGENTS_OBSERVE_DOCKER_IMAGE',
  'AGENTS_OBSERVE_DATA_DIR',
  'AGENTS_OBSERVE_LOGS_DIR',
  'AGENTS_OBSERVE_LOG_LEVEL',
  'AGENTS_OBSERVE_TEST_SKIP_PULL',
]
```

- [ ] **Step 2: Write two failing tests for the new config field**

In `test/config.test.mjs`, inside the `describe('config', ...)` block, append two new tests after the existing ones (after the `defaults logLevel to warn` test, before the closing `})`):

```javascript
it('defaults testSkipPull to false', async () => {
  const cfg = await loadConfig()
  expect(cfg.testSkipPull).toBe(false)
})

it('sets testSkipPull true when AGENTS_OBSERVE_TEST_SKIP_PULL=1', async () => {
  process.env.AGENTS_OBSERVE_TEST_SKIP_PULL = '1'
  const cfg = await loadConfig()
  expect(cfg.testSkipPull).toBe(true)
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run test/config.test.mjs`

Expected: the two new tests fail with errors like `expected undefined to be false` / `expected undefined to be true`. The other nine tests continue to pass.

- [ ] **Step 4: Add the field to `getConfig()` in `config.mjs`**

Open `hooks/scripts/lib/config.mjs`. Find the `return { ... }` block in `getConfig` (starts around line 90). Add a new field before the closing `mcpPortFile,` line. The final return block should include this new line:

```javascript
  return {
    serverPort,
    apiBaseUrl,
    baseOrigin,
    pluginDataDir,

    cliPath: resolve(installDir, './hooks/scripts/observe_cli.mjs'),
    logLevel: (process.env.AGENTS_OBSERVE_LOG_LEVEL || 'warn').toLowerCase(),
    logsDir: resolve(installDir, process.env.AGENTS_OBSERVE_LOGS_DIR || `${pluginDataDir}/logs`),

    /* Allowed server callbacks array */
    allowedCallbacks,

    projectSlug: overrides.projectSlug || process.env.AGENTS_OBSERVE_PROJECT_SLUG || null,
    containerName: process.env.AGENTS_OBSERVE_DOCKER_CONTAINER_NAME || 'agents-observe',
    dockerImage,
    dataDir: resolve(installDir, process.env.AGENTS_OBSERVE_DATA_DIR || `${pluginDataDir}/data`),
    API_ID: 'agents-observe',
    expectedVersion: version,

    /* Test harness only — skip `docker pull` when image is pre-loaded. See docs/plans/_queued/spec-fresh-install-test-harness.md */
    testSkipPull: process.env.AGENTS_OBSERVE_TEST_SKIP_PULL === '1',

    mcpPortFile,
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/config.test.mjs`

Expected: all eleven tests pass (nine existing + two new).

- [ ] **Step 6: Run the full unit test suite as a regression check**

Run: `npx vitest run`

Expected: all tests in `test/*.test.mjs` pass. (This exercises `config.test.mjs`, `http.test.mjs`, and `logger.test.mjs`.)

- [ ] **Step 7: Commit**

```bash
git add hooks/scripts/lib/config.mjs test/config.test.mjs
git commit -m "Add testSkipPull config field for fresh install test harness

Reads AGENTS_OBSERVE_TEST_SKIP_PULL=1 and exposes it as cfg.testSkipPull.
Consumed in a follow-up commit by docker.mjs to bypass docker pull when
the image is pre-loaded inside the test container."
```

---

## Task 2: Honor `testSkipPull` in `startServer()`

**Files:**
- Modify: `hooks/scripts/lib/docker.mjs:82-87`

**TDD note:** This task does not add a unit test. `docker.mjs` is not currently covered by unit tests (it wraps `execFile` for Docker CLI calls, and adding a mocking layer for a five-line branch would be disproportionate). The change is verified end-to-end by the integration test harness built in the remaining tasks — when the harness runs successfully with `AGENTS_OBSERVE_TEST_SKIP_PULL=1`, this branch has executed.

- [ ] **Step 1: Modify `startServer()` to skip `docker pull` when `config.testSkipPull` is true**

Open `hooks/scripts/lib/docker.mjs`. Find the existing pull block (around lines 81–87):

```javascript
  // Pull image
  log.info('Pulling image and starting container...')
  const pullResult = await run('docker', ['pull', config.dockerImage])
  if (!pullResult.ok) {
    log.error(`Failed to pull image: ${pullResult.stderr}`)
    return null
  }
```

Replace it with:

```javascript
  // Pull image (skipped in test harness when AGENTS_OBSERVE_TEST_SKIP_PULL=1)
  if (!config.testSkipPull) {
    log.info('Pulling image and starting container...')
    const pullResult = await run('docker', ['pull', config.dockerImage])
    if (!pullResult.ok) {
      log.error(`Failed to pull image: ${pullResult.stderr}`)
      return null
    }
  } else {
    log.info('AGENTS_OBSERVE_TEST_SKIP_PULL=1 — skipping docker pull (test harness)')
  }
```

- [ ] **Step 2: Run the full unit test suite as a regression check**

Run: `npx vitest run`

Expected: all unit tests pass. The change is syntactically valid and doesn't break any existing behavior (when `testSkipPull` is false, the original code path runs unchanged).

- [ ] **Step 3: Manual smoke test — verify the old path still works**

Run: `node hooks/scripts/observe_cli.mjs health`

Expected: either a healthy response (if a local server is already running) or a clear "server not running" message. The point is to confirm the modified file still imports and executes without syntax errors in real Node. Any import or syntax error would be caught here before we move on.

- [ ] **Step 4: Commit**

```bash
git add hooks/scripts/lib/docker.mjs
git commit -m "Honor testSkipPull in startServer (skip docker pull in harness)

When AGENTS_OBSERVE_TEST_SKIP_PULL=1, startServer bypasses the pull step
and assumes the image is already loaded in the local dockerd. Used by
the fresh install test harness to run against a pre-loaded tarball
without needing registry access for locally-built images."
```

---

## Task 3: Create `.dockerignore`

**Files:**
- Create: `.dockerignore`

**Context:** The test container's `Dockerfile` will `COPY . /plugin`, so the build context includes the entire repo. Without a `.dockerignore`, Docker ships hundreds of megabytes of `node_modules`, build artifacts, and `.git` history into the image. A focused ignore file keeps the context under a few MB.

- [ ] **Step 1: Create the `.dockerignore` file at the repo root**

Create `.dockerignore` with the following content:

```gitignore
# Fresh install test harness — keep build context small and reproducible

# Dependency trees (reinstalled inside the image)
node_modules
app/server/node_modules
app/client/node_modules

# Build outputs
app/client/dist
app/server/dist

# Runtime state
data
logs
*.db
*.db-journal

# Version control and editor state
.git
.gitignore
.vscode
.idea
*.swp
.DS_Store

# Local configuration
.env
.env.local
settings.local.json

# Existing harness tarballs (the driver writes to /tmp, not the repo, but belt-and-suspenders)
server-image.tar
*.tar
```

- [ ] **Step 2: Verify `docker build` picks up the ignore file**

Run: `docker build --no-cache -t agents-observe:local . 2>&1 | head -5`

Expected: the first line of output should show a "transferring context" step with a reasonable size (a few MB), not hundreds. For example: `=> transferring context: 3.42MB`. If the size is very large (>50MB), the ignore file isn't excluding enough — check for any unlisted large directories.

- [ ] **Step 3: Commit**

```bash
git add .dockerignore
git commit -m "Add .dockerignore to keep Docker build context small

Excludes node_modules, build outputs, runtime data, and VCS state from
Docker build contexts. Required by the fresh install test harness,
which COPYs the full repo into its test image."
```

---

## Task 4: Minimal test container — validate `claude --plugin-dir` works

**Files:**
- Create: `test/fresh-install/Dockerfile`
- Create: `test/fresh-install/entrypoint.sh`

**Context:** This is the load-bearing assumption in the entire plan. Before building any verification logic, we need to confirm that (a) the `claude` CLI can be installed inside the test container and (b) the `--plugin-dir` flag exists. If the flag has a different name or the CLI has no way to load a plugin from a local directory, this task surfaces that immediately and the plan stops here for reassessment.

- [ ] **Step 1: Create the Dockerfile**

Create `test/fresh-install/Dockerfile` with this content:

```dockerfile
# Fresh install test harness — test container image
# Runs a nested dockerd so the plugin can start its agents-observe server
# container in full isolation from the host.

FROM docker:27-dind

# Runtime dependencies:
# - bash: entrypoint script (Alpine default is ash)
# - curl + jq: verification checks against the server API
# - nodejs + npm: for the Claude Code CLI and the plugin hook scripts
RUN apk add --no-cache bash curl jq nodejs npm

# Install the Claude Code CLI globally. Pinned to whatever's latest at
# image build time — rebuilds pick up new versions.
RUN npm install -g @anthropic-ai/claude-code

# Copy plugin source into a known location. The .dockerignore at the repo
# root excludes node_modules, build artifacts, and VCS state.
COPY . /plugin

# Entrypoint script — orchestrates dockerd, image load, claude run,
# verification, and diagnostic dump.
COPY test/fresh-install/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
```

- [ ] **Step 2: Create the minimal entrypoint that validates the environment**

Create `test/fresh-install/entrypoint.sh` with this initial content. Subsequent tasks will expand it; this version only proves the container and claude CLI work.

```bash
#!/bin/bash
# Fresh install test harness — entrypoint (runs inside test container)
# Task 4 version: validates environment only. Expanded in later tasks.

set -uo pipefail

echo "=== Fresh install test harness — entrypoint starting ==="
echo "Container: $(hostname)"
echo "Date: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo ""

echo "=== Tool versions ==="
echo "bash: $(bash --version | head -1)"
echo "node: $(node --version)"
echo "npm: $(npm --version)"
echo "curl: $(curl --version | head -1)"
echo "jq: $(jq --version)"
echo "docker CLI: $(docker --version)"
echo ""

echo "=== claude CLI ==="
if ! command -v claude >/dev/null 2>&1; then
  echo "FATAL: claude CLI not found on PATH"
  exit 1
fi
claude --version || { echo "FATAL: claude --version failed"; exit 1; }
echo ""

echo "=== Probing claude flags ==="
claude --help 2>&1 | tee /tmp/claude-help.txt
echo ""

if grep -q -- '--plugin-dir' /tmp/claude-help.txt; then
  echo "PASS: --plugin-dir flag is present in claude --help"
else
  echo "FAIL: --plugin-dir flag NOT present in claude --help"
  echo "      The plan assumes this flag exists. Stop and reassess."
  exit 1
fi

echo ""
echo "=== Minimal environment check complete ==="
exit 0
```

- [ ] **Step 3: Build the test image**

Run from the repo root:

```bash
docker build -t agents-observe-test:local -f test/fresh-install/Dockerfile .
```

Expected: build succeeds. Final line contains `naming to docker.io/library/agents-observe-test:local`. If `npm install -g @anthropic-ai/claude-code` fails, inspect the error — most likely needs a newer Node version (upgrade the Alpine package version in the Dockerfile) or network access.

- [ ] **Step 4: Run the test container (no privileged flag needed yet — we're not using dockerd in this task)**

```bash
docker run --rm agents-observe-test:local
```

Expected output ends with either:
- `PASS: --plugin-dir flag is present in claude --help` → proceed to Step 5.
- `FAIL: --plugin-dir flag NOT present in claude --help` → **STOP**. Inspect the `claude --help` output in the run log and identify the correct flag name. Update the spec and the Dockerfile/entrypoint to use that flag, then re-run. If no plugin-loading flag exists, the plan cannot proceed without a redesign.

- [ ] **Step 5: Commit**

```bash
git add test/fresh-install/Dockerfile test/fresh-install/entrypoint.sh
git commit -m "Add minimal test container for fresh install harness

Alpine docker:dind base with Node, the Claude Code CLI, and a minimal
entrypoint that validates --plugin-dir is a real flag. This is the
risk-reduction step — remaining tasks build on the assumption that
this flag loads plugins from a local directory."
```

---

## Task 5: Wire up plugin source and verify claude loads the plugin

**Files:**
- Modify: `test/fresh-install/entrypoint.sh`

**Context:** Task 4 proved the test image builds and the `claude` CLI exists with the expected flag. Now we actually invoke it against the plugin source we COPYed into `/plugin`. We haven't loaded the server image yet, so the plugin's startup will fail when it tries to run the agents-observe container — but that failure is informative: it tells us whether Claude saw the plugin at all. If `mcp.log` and `cli.log` appear inside the container after this run, MCP discovery is working.

- [ ] **Step 1: Expand `test/fresh-install/entrypoint.sh` to start dockerd, run claude against the plugin, and show logs**

Overwrite `test/fresh-install/entrypoint.sh` with this expanded version:

```bash
#!/bin/bash
# Fresh install test harness — entrypoint (runs inside test container)
# Task 5 version: runs claude against the plugin source and dumps logs.

set -uo pipefail

echo "=== Fresh install test harness — entrypoint starting ==="
echo "Container: $(hostname)"
echo "Date: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo ""

# --- Step 1: Start inner dockerd ---------------------------------------
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

# --- Step 2: Show tool versions ----------------------------------------
echo "=== Tool versions ==="
echo "node: $(node --version)"
echo "claude: $(claude --version)"
echo "docker CLI: $(docker --version)"
echo ""

# --- Step 3: Run claude against the plugin ------------------------------
echo "=== Running claude --plugin-dir /plugin -p ... ==="
CLAUDE_STDOUT=/tmp/claude.stdout
CLAUDE_STDERR=/tmp/claude.stderr
set +e
claude \
  --plugin-dir /plugin \
  -p "hello, this is a fresh install smoke test" \
  >"$CLAUDE_STDOUT" 2>"$CLAUDE_STDERR"
CLAUDE_EXIT=$?
set -e

echo "claude exit code: $CLAUDE_EXIT"
echo ""
echo "--- claude stdout ---"
cat "$CLAUDE_STDOUT" || true
echo ""
echo "--- claude stderr ---"
cat "$CLAUDE_STDERR" || true
echo ""

# --- Step 4: Dump plugin logs to see if claude discovered the MCP ------
echo "=== Searching for plugin log files ==="
find / -type f \( -name 'mcp.log' -o -name 'cli.log' \) 2>/dev/null | while read -r logfile; do
  echo ""
  echo "--- $logfile ---"
  cat "$logfile"
done
echo ""

echo "=== Docker state ==="
docker ps -a
echo ""
docker images
echo ""

echo "=== Task 5 entrypoint complete ==="
exit 0
```

- [ ] **Step 2: Rebuild the test image (entrypoint changed)**

Run: `docker build -t agents-observe-test:local -f test/fresh-install/Dockerfile .`

Expected: quick rebuild (only the entrypoint COPY layer is invalidated).

- [ ] **Step 3: Run the test container with `--privileged` and the OAuth token**

```bash
docker run \
  --privileged \
  --rm \
  -e "CLAUDE_CODE_OAUTH_TOKEN=$AGENTS_OBSERVE_TEST_CLAUDE_OAUTH_TOKEN" \
  agents-observe-test:local
```

(Ensure `AGENTS_OBSERVE_TEST_CLAUDE_OAUTH_TOKEN` is set in your shell — source from `.env` if needed: `source .env` or `export AGENTS_OBSERVE_TEST_CLAUDE_OAUTH_TOKEN=sk-ant-oat-...`.)

Expected outcomes, in order of observation:
1. `dockerd is up after <N>s` — inner dockerd starts successfully.
2. `claude --version` prints a version.
3. `claude --plugin-dir /plugin -p ...` runs and produces stdout (claude's response to the prompt).
4. The log-file find loop prints at least one `mcp.log` and one `cli.log` — **this is the critical signal**: if these files exist, Claude discovered the plugin and spawned the MCP server.
5. `docker ps -a` may or may not show the agents-observe container. At this task's stage, it shouldn't — we haven't loaded the server image, so `startServer()` will fail inside MCP with either a pull failure (registry unreachable or image missing) or an image-not-found error. That's expected and informative.

If `mcp.log` and `cli.log` are NOT found after this run, the plan stops here: Claude isn't loading the plugin at all, and the assumptions in the spec need revisiting. Capture the full docker run output for diagnosis.

- [ ] **Step 4: Commit**

```bash
git add test/fresh-install/entrypoint.sh
git commit -m "Expand harness entrypoint to run claude against plugin source

Starts inner dockerd, invokes claude with --plugin-dir /plugin, and
dumps any discovered mcp.log/cli.log. At this stage the server image
isn't loaded yet, so plugin startup is expected to fail — the point
is to confirm Claude discovers the plugin and spawns its MCP server."
```

---

## Task 6: Pre-load the server image into inner dockerd

**Files:**
- Modify: `test/fresh-install/entrypoint.sh`

**Context:** Now that we've confirmed Claude sees the plugin, we pre-load the agents-observe server image into the inner dockerd so MCP's `startServer()` finds it without needing a registry. The image tarball is mounted from the host into `/server-image.tar` inside the test container. This task also sets `AGENTS_OBSERVE_TEST_SKIP_PULL=1` so `startServer()` skips its `docker pull` step (Task 2's production change becomes load-bearing here).

- [ ] **Step 1: Build the server image on the host**

Run from the repo root:

```bash
docker build -t agents-observe:local .
```

Expected: server image builds successfully. This is the image the plugin's `startServer()` will run inside the test container.

- [ ] **Step 2: Save the server image to a tarball**

```bash
docker save agents-observe:local -o /tmp/agents-observe-server-image.tar
ls -lh /tmp/agents-observe-server-image.tar
```

Expected: a `.tar` file on the order of 100–300MB.

- [ ] **Step 3: Update `test/fresh-install/entrypoint.sh` to load the image before running claude**

Overwrite `test/fresh-install/entrypoint.sh`:

```bash
#!/bin/bash
# Fresh install test harness — entrypoint (runs inside test container)
# Task 6 version: pre-loads server image tarball before running claude.

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

# --- Configure the plugin to use the loaded image ----------------------
# The plugin's startServer() constructs an image name like
# ghcr.io/simple10/agents-observe:v<version>. Override it to the locally
# loaded image via AGENTS_OBSERVE_DOCKER_IMAGE, and skip the pull step.
export AGENTS_OBSERVE_DOCKER_IMAGE=agents-observe:local
export AGENTS_OBSERVE_TEST_SKIP_PULL=1
echo "AGENTS_OBSERVE_DOCKER_IMAGE=$AGENTS_OBSERVE_DOCKER_IMAGE"
echo "AGENTS_OBSERVE_TEST_SKIP_PULL=$AGENTS_OBSERVE_TEST_SKIP_PULL"
echo ""

# --- Run claude against the plugin -------------------------------------
echo "=== Running claude --plugin-dir /plugin -p ... ==="
CLAUDE_STDOUT=/tmp/claude.stdout
CLAUDE_STDERR=/tmp/claude.stderr
set +e
claude \
  --plugin-dir /plugin \
  -p "hello, this is a fresh install smoke test" \
  >"$CLAUDE_STDOUT" 2>"$CLAUDE_STDERR"
CLAUDE_EXIT=$?
set -e

echo "claude exit code: $CLAUDE_EXIT"
echo ""
echo "--- claude stdout ---"
cat "$CLAUDE_STDOUT" || true
echo ""
echo "--- claude stderr ---"
cat "$CLAUDE_STDERR" || true
echo ""

# --- Dump plugin logs and docker state ---------------------------------
echo "=== Plugin log files ==="
find / -type f \( -name 'mcp.log' -o -name 'cli.log' \) 2>/dev/null | while read -r logfile; do
  echo ""
  echo "--- $logfile ---"
  cat "$logfile"
done
echo ""

echo "=== Docker state ==="
docker ps -a
echo ""
docker images
echo ""

echo "=== Task 6 entrypoint complete ==="
exit 0
```

- [ ] **Step 4: Rebuild the test image**

```bash
docker build -t agents-observe-test:local -f test/fresh-install/Dockerfile .
```

- [ ] **Step 5: Run the test container with the tarball mounted and both env vars set**

```bash
docker run \
  --privileged \
  --rm \
  -v /tmp/agents-observe-server-image.tar:/server-image.tar:ro \
  -e "CLAUDE_CODE_OAUTH_TOKEN=$AGENTS_OBSERVE_TEST_CLAUDE_OAUTH_TOKEN" \
  agents-observe-test:local
```

Expected observations:
1. `Server image loaded successfully` line appears.
2. `mcp.log` contains a line like `AGENTS_OBSERVE_TEST_SKIP_PULL=1 — skipping docker pull (test harness)` — this proves Task 2's production change is firing.
3. `docker ps -a` (the one near the end, inside the test container) shows `agents-observe` as a running container.
4. `mcp.log` shows the `startServer` flow completing successfully.
5. `cli.log` shows at least a SessionStart hook event being POSTed.

If `docker ps -a` still doesn't show `agents-observe`, inspect `mcp.log` for the failure mode. Common issues: image tag mismatch (the plugin is trying to run a different tag than the one we loaded — fix by ensuring `AGENTS_OBSERVE_DOCKER_IMAGE` is correctly exported before claude runs), or port conflicts (unlikely inside an isolated test container).

- [ ] **Step 6: Commit**

```bash
git add test/fresh-install/entrypoint.sh
git commit -m "Pre-load server image tarball and configure skip-pull in harness

Entrypoint now loads /server-image.tar into the inner dockerd before
running claude, and exports AGENTS_OBSERVE_DOCKER_IMAGE +
AGENTS_OBSERVE_TEST_SKIP_PULL so the plugin uses the loaded image
without attempting a registry pull."
```

---

## Task 7: Add verification checks

**Files:**
- Modify: `test/fresh-install/entrypoint.sh`

**Context:** The entrypoint now runs claude against a working plugin setup. Next we add the four verification checks from the spec (§5) and track their results. Checks 1–3 are hard (a failure means the run fails); check 4 is soft (logged warning only).

- [ ] **Step 1: Add verification functions before the "Task 6 entrypoint complete" line**

Open `test/fresh-install/entrypoint.sh`. Remove the line `echo "=== Task 6 entrypoint complete ==="` and everything after it (the `exit 0`). Add the following verification block at the same position:

```bash
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
MCP_LOGS="$(find / -type f -name 'mcp.log' 2>/dev/null)"
CLI_LOGS="$(find / -type f -name 'cli.log' 2>/dev/null)"
if [ -n "$MCP_LOGS" ]; then
  CHECK_4_MCP_COUNT="$(grep -c 'ERROR' $MCP_LOGS 2>/dev/null | awk -F: '{s+=$NF} END {print s+0}')"
fi
if [ -n "$CLI_LOGS" ]; then
  CHECK_4_CLI_COUNT="$(grep -c 'ERROR' $CLI_LOGS 2>/dev/null | awk -F: '{s+=$NF} END {print s+0}')"
fi

echo "Check 1 (inner container exists): $CHECK_1_RESULT — $CHECK_1_DETAIL"
echo "Check 2 (server health):          $CHECK_2_RESULT — $CHECK_2_DETAIL"
echo "Check 3 (events captured):        $CHECK_3_RESULT — $CHECK_3_DETAIL"
echo "Check 4 (mcp.log ERROR lines):    $CHECK_4_MCP_COUNT"
echo "Check 4 (cli.log ERROR lines):    $CHECK_4_CLI_COUNT"
echo ""

# Determine overall exit code — checks 1-3 are hard, check 4 is soft
if [ "$CHECK_1_RESULT" = "PASS" ] && [ "$CHECK_2_RESULT" = "PASS" ] && [ "$CHECK_3_RESULT" = "PASS" ]; then
  OVERALL="PASS"
  OVERALL_EXIT=0
else
  OVERALL="FAIL"
  OVERALL_EXIT=1
fi

echo "=== Overall: $OVERALL ==="
exit $OVERALL_EXIT
```

- [ ] **Step 2: Rebuild the test image**

```bash
docker build -t agents-observe-test:local -f test/fresh-install/Dockerfile .
```

- [ ] **Step 3: Run the test container**

```bash
docker run \
  --privileged \
  --rm \
  -v /tmp/agents-observe-server-image.tar:/server-image.tar:ro \
  -e "CLAUDE_CODE_OAUTH_TOKEN=$AGENTS_OBSERVE_TEST_CLAUDE_OAUTH_TOKEN" \
  agents-observe-test:local
```

Expected:
- All three hard checks print `PASS` with useful detail (e.g., `Check 2 (server health): PASS — {"ok":true,"version":"0.7.4","runtime":"docker"}`).
- Check 4 may report zero or small nonzero error counts depending on what the plugin logged.
- Overall exit code is 0.
- Final line: `=== Overall: PASS ===`

If any hard check fails, inspect the detail field — the error message is designed to show exactly what was seen vs expected.

- [ ] **Step 4: Commit**

```bash
git add test/fresh-install/entrypoint.sh
git commit -m "Add verification phase to fresh install harness entrypoint

Three hard checks (container running, health OK, events captured) and
one soft check (ERROR lines in mcp.log/cli.log). Exit code reflects
hard check results only; soft check results are logged for inspection."
```

---

## Task 8: Add unconditional diagnostic dump

**Files:**
- Modify: `test/fresh-install/entrypoint.sh`

**Context:** Verification runs before this but the diagnostic dump should happen unconditionally — on both pass and fail — so every run produces the same self-contained output. On failure, it's the debugging bundle; on success, it's a baseline to diff against. The cleanest way is to reorganize the script so verification results are captured into variables, then a single "dump everything" block runs at the end.

- [ ] **Step 1: Restructure the entrypoint so the final diagnostic dump runs regardless of check outcomes**

The current entrypoint already runs verification before exit. We just need to ensure the "dump everything" block comes after verification and the `exit $OVERALL_EXIT` is the very last line. The existing structure already does most of this — we need to reorganize so all the diagnostic sections (claude stdout/stderr, docker state, logs) print AFTER verification, not before, and appear under clear `=== ... ===` headers.

Replace the entire body of `test/fresh-install/entrypoint.sh` with this final version:

```bash
#!/bin/bash
# Fresh install test harness — entrypoint (runs inside test container)
# Final version: startup + claude run + verification + unconditional dump.

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
if ! docker images --format '{{.Repository}}:{{.Tag}}' | grep -q '^agents-observe:local$'; then
  echo "FATAL: agents-observe:local not present after load"
  docker images
  exit 1
fi
echo "Server image loaded successfully"
echo ""

# --- Configure plugin to use loaded image ------------------------------
export AGENTS_OBSERVE_DOCKER_IMAGE=agents-observe:local
export AGENTS_OBSERVE_TEST_SKIP_PULL=1

# --- Run claude against the plugin -------------------------------------
echo "=== Running claude --plugin-dir /plugin -p ... ==="
CLAUDE_STDOUT=/tmp/claude.stdout
CLAUDE_STDERR=/tmp/claude.stderr
set +e
claude \
  --plugin-dir /plugin \
  -p "hello, this is a fresh install smoke test" \
  >"$CLAUDE_STDOUT" 2>"$CLAUDE_STDERR"
CLAUDE_EXIT=$?
set -e
echo "claude exit code: $CLAUDE_EXIT"
echo ""

# --- Verification phase -------------------------------------------------
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
echo ""

# --- Final status ------------------------------------------------------
if [ "$CHECK_1_RESULT" = "PASS" ] && [ "$CHECK_2_RESULT" = "PASS" ] && [ "$CHECK_3_RESULT" = "PASS" ]; then
  echo "=== final status: PASS ==="
  exit 0
else
  echo "=== final status: FAIL ==="
  exit 1
fi
```

- [ ] **Step 2: Rebuild the test image**

```bash
docker build -t agents-observe-test:local -f test/fresh-install/Dockerfile .
```

- [ ] **Step 3: Run the test container and confirm the full diagnostic dump prints**

```bash
docker run \
  --privileged \
  --rm \
  -v /tmp/agents-observe-server-image.tar:/server-image.tar:ro \
  -e "CLAUDE_CODE_OAUTH_TOKEN=$AGENTS_OBSERVE_TEST_CLAUDE_OAUTH_TOKEN" \
  agents-observe-test:local
```

Expected: the output now has a clear `=== DIAGNOSTIC BUNDLE ===` section near the end containing all five diagnostic subsections (claude, docker state, docker logs, mcp.log, cli.log, verification results) followed by `=== final status: PASS ===` (or FAIL with a useful error trail).

- [ ] **Step 4: Commit**

```bash
git add test/fresh-install/entrypoint.sh
git commit -m "Add unconditional diagnostic dump to harness entrypoint

Every run now prints a self-contained bundle: claude stdout/stderr,
docker state, inner container logs, mcp.log, cli.log, and verification
results — regardless of pass or fail. Failure runs contain everything
a debugger needs in one scroll."
```

---

## Task 9: Write the host-side driver script

**Files:**
- Create: `scripts/test-fresh-install.sh`

**Context:** Up to this point we've been running each step manually with `docker build`, `docker save`, and `docker run` commands. Now we assemble those exact commands into a single script that a human (or a future release pipeline) can invoke with one command.

- [ ] **Step 1: Create the driver script**

Create `scripts/test-fresh-install.sh`:

```bash
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
#
# Usage:
#   ./scripts/test-fresh-install.sh
#
# See docs/plans/_queued/spec-fresh-install-test-harness.md for rationale.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

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
  echo "CLI inside the test container. The driver remaps it to" >&2
  echo "CLAUDE_CODE_OAUTH_TOKEN when running the container (that's the name" >&2
  echo "claude itself reads)." >&2
  echo "" >&2
  echo "Set it in your shell or a gitignored .env file:" >&2
  echo "  export AGENTS_OBSERVE_TEST_CLAUDE_OAUTH_TOKEN=sk-ant-oat-..." >&2
  exit 1
fi

# --- Temp workspace ----------------------------------------------------
TMP_DIR="$(mktemp -d -t agents-observe-fresh-install.XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

TARBALL="$TMP_DIR/server-image.tar"

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
  agents-observe-test:local
EXIT_CODE=$?
set -e

echo ""
echo "=== test-fresh-install exited with code $EXIT_CODE ==="
exit $EXIT_CODE
```

- [ ] **Step 2: Make the script executable**

```bash
chmod +x scripts/test-fresh-install.sh
```

- [ ] **Step 3: Run the full harness end-to-end via the driver**

```bash
./scripts/test-fresh-install.sh
```

Expected: the script runs all four phases, prints the diagnostic bundle, and exits 0 with `=== final status: PASS ===`. The temp directory is cleaned up automatically via the trap.

- [ ] **Step 4: Verify no host state was polluted**

```bash
docker ps -a | grep agents-observe || echo "no leftover containers"
ls /tmp/agents-observe-fresh-install.* 2>/dev/null || echo "no leftover temp dirs"
```

Expected: `no leftover containers` and `no leftover temp dirs`. The `--rm` flag on `docker run` cleans up the test container; the trap cleans up the tarball. The `agents-observe` server container that ran *inside* the test container died when the test container's inner dockerd died.

(Note: the host will still have the `agents-observe:local` and `agents-observe-test:local` *images*, which is intentional — they speed up subsequent runs via Docker's layer cache. Only the runtime state should be gone.)

- [ ] **Step 5: Commit**

```bash
git add scripts/test-fresh-install.sh
git commit -m "Add scripts/test-fresh-install.sh driver for fresh install harness

Single-command entrypoint: preflight checks (docker available, OAuth
token set), builds the server image, saves it to a tarball, builds
the test container, and runs it. Exits with the test container's
exit code."
```

---

## Task 10: Write the README

**Files:**
- Create: `test/fresh-install/README.md`

- [ ] **Step 1: Create the README**

Create `test/fresh-install/README.md`:

```markdown
# Fresh Install Test Harness

Reproduces a pristine fresh-install environment and runs the real `claude` CLI against the agents-observe plugin end-to-end, verifying that the MCP-spawn → `startServer()` → event-capture flow works from zero state.

## Why this exists

The plugin is supposed to auto-start its Docker server container on first use (via an MCP server Claude spawns when loading the plugin). When this fails on a user's machine (see simple10/agents-observe#6), reproducing it locally is hard — prior images, containers, and `~/.agents-observe/` state always contaminate the test. This harness runs everything inside an isolated `docker:dind` container so every run is pristine.

## Usage

```bash
export AGENTS_OBSERVE_TEST_CLAUDE_OAUTH_TOKEN=sk-ant-oat-...
./scripts/test-fresh-install.sh
```

The script builds the server image, saves it to a tarball, builds the test container, runs it with `--privileged` (required for nested Docker), and exits with the test container's exit code. A full diagnostic bundle (claude stdout/stderr, docker state, inner container logs, `mcp.log`, `cli.log`, verification results) is printed unconditionally at the end of every run.

## Required environment variables

| Variable | Purpose |
|---|---|
| `AGENTS_OBSERVE_TEST_CLAUDE_OAUTH_TOKEN` | OAuth token for the `claude` CLI. The driver remaps this to `CLAUDE_CODE_OAUTH_TOKEN` when launching the test container — `CLAUDE_CODE_OAUTH_TOKEN` is what `claude` itself reads. |

Keep this in a gitignored `.env` file and source it before running the harness, or export it in your shell.

## What the harness verifies

Four checks run after `claude` exits:

1. **Inner container exists** — `docker ps -a` inside the test container shows a running `agents-observe` container. Hard check.
2. **Server health** — `curl http://127.0.0.1:4981/api/health` returns 200 with `ok: true`. Hard check.
3. **Events captured** — `curl http://127.0.0.1:4981/api/sessions/recent` returns at least one session, proving the hook → server path worked. Hard check.
4. **Error count in logs** — greps `ERROR` lines in `mcp.log` and `cli.log`. Soft check (reported, does not fail the run on its own).

The run exits 0 iff all three hard checks pass.

## Gotchas

- **`--privileged` is required.** The test container runs its own `dockerd`, which needs elevated privileges. This is fine on a developer machine; do not use this harness in untrusted CI runners without thought.
- **Performance.** On macOS, Docker Desktop is already a Linux VM, so the harness is running dockerd-in-container-in-VM. Budget ~2–3 minutes per end-to-end run. That's normal.
- **OAuth token quota.** Every run makes a real API call against Anthropic using the provided token. The test prompt is minimal (one sentence) to keep per-run cost negligible, but running the harness in a tight loop will consume quota.
- **Locally-built images only (v1).** The harness tests the server image built from the current tree — it does not test the marketplace-published image. A published-image mode is tracked for a future release-gate version.
- **Host state.** After the harness exits, no runtime state remains on the host. The `agents-observe:local` and `agents-observe-test:local` *images* are kept intentionally for cache reuse; delete them manually if you want a true cold cache (`docker rmi agents-observe:local agents-observe-test:local`).

## What to do when it fails

Read the diagnostic bundle from top to bottom:

1. Did inner `dockerd` start? (Look for `dockerd is up after Ns`.)
2. Did the server image load? (`Server image loaded successfully`.)
3. Did `claude` run? (`claude exit code: 0` and some stdout.)
4. Did the plugin's MCP server spawn? (Check `mcp.log` — if it's missing, plugin discovery failed.)
5. Did `startServer()` succeed? (`mcp.log` should show image tag, container start, health check pass.)
6. Did the SessionStart event arrive at the server? (`cli.log` should show a POST to `/api/events`.)

The first PASS/FAIL that doesn't match what you expect is the bug.

## Files

| Path | Purpose |
|---|---|
| `scripts/test-fresh-install.sh` | Host-side driver (what you run) |
| `test/fresh-install/Dockerfile` | Test container image definition |
| `test/fresh-install/entrypoint.sh` | Orchestrates dockerd + claude + verification inside the container |
| `test/fresh-install/README.md` | This file |
| `.dockerignore` | Keeps the build context small |
| `hooks/scripts/lib/config.mjs` | Exposes `testSkipPull` from `AGENTS_OBSERVE_TEST_SKIP_PULL` |
| `hooks/scripts/lib/docker.mjs` | Honors `testSkipPull` in `startServer()` to bypass `docker pull` |

See `docs/plans/_queued/spec-fresh-install-test-harness.md` for the full design rationale.
```

- [ ] **Step 2: Commit**

```bash
git add test/fresh-install/README.md
git commit -m "Document fresh install test harness usage and gotchas

Covers required env vars, verification checks, known gotchas
(--privileged, macOS performance, OAuth quota), and a debugging
flow for reading the diagnostic bundle when the harness fails."
```

---

## Task 11: Final verification

**Files:** None (verification only)

**Context:** The harness is built. This task confirms it behaves correctly on both a happy-path run and a deliberately-broken run, and that it leaves no host state behind.

- [ ] **Step 1: Clean any leftover state and run the happy path**

```bash
docker rmi agents-observe:local agents-observe-test:local 2>/dev/null || true
./scripts/test-fresh-install.sh
```

Expected: cold-cache build (slower than subsequent runs), then a PASS result. The final lines of output should include:

```
=== final status: PASS ===
=== test-fresh-install exited with code 0 ===
```

Record this output — it's the baseline. If any hard check fails on the happy path, debug before proceeding (start with the diagnostic bundle sections in order).

- [ ] **Step 2: Deliberately break `docker.mjs` and confirm the harness catches it**

Temporarily edit `hooks/scripts/lib/docker.mjs` to force `startServer()` to fail immediately — this guarantees no container is ever created, which makes the failure mode deterministic (all three hard checks should fail cleanly).

Find the `startServer` function definition:

```javascript
export async function startServer(config, log = console) {
  // Check Docker availability
  const dockerCheck = await run('docker', ['info'])
```

Insert two lines immediately after the opening brace, before the Docker availability check:

```javascript
export async function startServer(config, log = console) {
  log.error('TEMP: harness verification break — simulated startServer failure')
  return null
  // Check Docker availability
  const dockerCheck = await run('docker', ['info'])
```

Then run:

```bash
./scripts/test-fresh-install.sh
```

Expected: the harness exits nonzero with `=== final status: FAIL ===`. The diagnostic bundle should clearly show:
- Check 1 (inner container exists): **FAIL** with `status='' (expected 'Up ...')` — no container was created.
- Check 2 (server health): **FAIL** with a curl connection-refused error.
- Check 3 (events captured): **FAIL** with a curl connection-refused error.
- `mcp.log` section contains the line `TEMP: harness verification break — simulated startServer failure`.

This proves the diagnostic bundle surfaces the root cause. If `mcp.log` is present in the dump and the simulated-failure line appears in it, diagnostics are working. If `mcp.log` is missing or doesn't show the error, there's a gap in the bundle that needs fixing before considering the harness complete.

- [ ] **Step 3: Revert the deliberate break**

```bash
git checkout hooks/scripts/lib/docker.mjs
```

Verify the revert:

```bash
grep 'TEMP: harness test' hooks/scripts/lib/docker.mjs && echo "NOT REVERTED" || echo "reverted cleanly"
```

Expected: `reverted cleanly`.

- [ ] **Step 4: Re-run the happy path to confirm nothing is broken**

```bash
./scripts/test-fresh-install.sh
```

Expected: PASS again, same as Step 1.

- [ ] **Step 5: Confirm no host state was left behind**

```bash
docker ps -a | grep agents-observe
ls /tmp/agents-observe-fresh-install.* 2>/dev/null
ls ~/.agents-observe/ 2>/dev/null
```

Expected:
- `docker ps -a` may show the two *images* (`agents-observe:local`, `agents-observe-test:local`) if you list them via `docker images` instead, but should show no running or stopped containers named `agents-observe` that were created during the harness run.
- `/tmp/agents-observe-fresh-install.*` should not exist (cleaned up by trap).
- `~/.agents-observe/` contents, if present, should be unchanged from before the harness ran — the harness doesn't touch the host's plugin data directory because everything ran inside a nested container.

- [ ] **Step 6: No commit needed — this task is verification only**

If all previous steps pass, the feature is complete. The final commit log on the feature branch should look like:

```
Document fresh install test harness usage and gotchas
Add scripts/test-fresh-install.sh driver for fresh install harness
Add unconditional diagnostic dump to harness entrypoint
Add verification phase to fresh install harness entrypoint
Pre-load server image tarball and configure skip-pull in harness
Expand harness entrypoint to run claude against plugin source
Add minimal test container for fresh install harness
Add .dockerignore to keep Docker build context small
Honor testSkipPull in startServer (skip docker pull in harness)
Add testSkipPull config field for fresh install test harness
Extend verification to grep cli.log for errors
Add design spec for fresh install test harness
```

Plus the design spec commits already on the branch.
