# Fresh Install Test Harness

Reproduces a pristine fresh-install environment and runs the real `claude` CLI against the agents-observe plugin end-to-end, verifying that the MCP-spawn → `startServer()` → event-capture flow works from zero state.

## Why this exists

The plugin auto-starts its Docker server container on first use via an MCP server Claude spawns when loading the plugin. When this fails on a user's machine (see [#6](https://github.com/simple10/agents-observe/issues/6)), reproducing it locally is hard — prior images, containers, and data directories contaminate the test. This harness runs everything inside an isolated `docker:dind` container so every run is pristine.

## Usage

```bash
# Set the OAuth token (or put it in .env — the script sources it)
export AGENTS_OBSERVE_TEST_CLAUDE_OAUTH_TOKEN=sk-ant-oat-...

# Run the harness
./scripts/test-fresh-install.sh
```

The script builds the server image, saves it to a tarball, builds the test container, runs it with `--privileged` (required for nested Docker), and exits with the test container's exit code. A full diagnostic bundle is printed at the end of every run.

## Required environment variables

| Variable | Purpose |
|---|---|
| `AGENTS_OBSERVE_TEST_CLAUDE_OAUTH_TOKEN` | OAuth token for the `claude` CLI. The driver remaps this to `CLAUDE_CODE_OAUTH_TOKEN` when launching the test container. Keep it in a gitignored `.env` file — the driver auto-sources it. |

## What the harness verifies

Four checks run after `claude` exits:

1. **Inner container exists** — `docker ps -a` inside the test container shows a running `agents-observe` container. Hard check.
2. **Server health** — `curl http://127.0.0.1:4981/api/health` returns 200 with `ok: true`. Hard check.
3. **Events captured** — `curl http://127.0.0.1:4981/api/sessions/recent` returns at least one session. Hard check.
4. **Error count in logs** — greps `ERROR` lines in `mcp.log` and `cli.log`. Soft check (reported, does not fail the run).

The run exits 0 iff all three hard checks pass.

## Gotchas

- **`--privileged` is required.** The test container runs its own `dockerd`, which needs elevated privileges. Fine on a developer machine.
- **Performance.** On macOS, Docker Desktop is already a Linux VM, so the harness runs dockerd-in-container-in-VM. Budget ~2–3 minutes per end-to-end run.
- **OAuth token quota.** Every run makes a real API call against Anthropic. The prompt is minimal (one sentence) to keep cost negligible.
- **Locally-built images only (v1).** The harness tests the server image built from the current tree, not the marketplace-published image.
- **Node.js and Claude CLI are unpinned** in the test container — Alpine's current `nodejs` package and the latest `@anthropic-ai/claude-code` from npm. This is intentional (catches regressions against whatever's latest) but means the image needs rebuilding periodically to pick up updates.
- **Docker Desktop mount paths.** On macOS, the tarball is saved inside the repo directory (not `/tmp`) because Docker Desktop can only bind-mount from paths it shares (typically `/Users/`).
- **MCP config path.** The entrypoint generates a temporary `.mcp.json` with absolute paths because `--plugin-dir` doesn't auto-load MCP configs, and the plugin's `${CLAUDE_PLUGIN_ROOT}` variable isn't set in the `--mcp-config` context.

## What to do when it fails

Read the diagnostic bundle from top to bottom:

1. Did inner `dockerd` start? (Look for `dockerd is up after Ns`.)
2. Did the server image load? (`Server image loaded successfully`.)
3. Did `claude` run? (`claude exit code: 0` and some stdout.)
4. Did the MCP server start? (`mcp.log` should show `Server started successfully`.)
5. Is the server container running? (`docker ps -a` shows `agents-observe` Up.)
6. Did hooks reach the server? (`cli.log` — early hooks may show `ECONNREFUSED` if they fire before the server starts; later hooks should succeed.)

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
