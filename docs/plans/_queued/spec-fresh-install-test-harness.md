# Design Spec: Fresh Install Test Harness

## Context

The agents-observe plugin ships a Docker-based server container that's meant to auto-start on first use via an MCP server Claude Code spawns when it loads the plugin. Issue simple10/agents-observe#6 reports that this auto-start doesn't happen on at least one user's machine: the container "was never created" on fresh install. PR simple10/agents-observe#5 proposes a fallback — have the SessionStart hook also call `startServer()` — but that's a symptom-level fix that doesn't explain why the MCP path failed in the first place.

We don't have a way to reproduce fresh-install conditions on demand. Every time the maintainer tests locally, prior state (pulled images, existing containers, `~/.agents-observe/`, prior hook runs) contaminates the test. And when a user hits the bug, the relevant diagnostic data (mcp.log, docker state, health responses) lives in places they don't know to look.

This harness fixes both problems: one command produces a pristine environment, runs the real Claude Code CLI against the real plugin, and dumps everything we need to see *why* startup succeeded or failed.

## Goals

- **True isolation.** Every run starts from nothing — no leftover containers, no cached images polluting the test, no stale plugin data. When the harness exits, no state persists on the host.
- **Real code path.** Use the actual `claude` binary, loading the actual plugin via `--plugin-dir`, so Claude performs MCP discovery and spawns the MCP server the same way it does for a first-time user. Simulation wouldn't catch discovery regressions; this does.
- **Full diagnostic bundle on every run.** Always dump mcp.log, cli.log, inner `docker logs`, claude stdout/stderr, and verification results — regardless of pass/fail. When something breaks, the maintainer (or any user who can run the harness) sees the whole picture in one scroll.
- **Single-command invocation.** `./scripts/test-fresh-install.sh` does everything: builds the server image, builds the test image, runs the test container, reports pass/fail, exits with a usable status code.
- **Test locally-built code.** The server image tested is the one built from the current tree, not whatever's on the marketplace. Catches regressions in uncommitted work.

## Non-goals (v1)

- CI integration. Local-only for now.
- Published-image mode (testing what's actually on the marketplace). Valuable as a pre-release gate, but add later.
- `justfile` or `release.sh` integration. Standalone shell script only, to avoid polluting `justfile` before we know the harness is stable.
- End-user-facing diagnostic tool (e.g., a skill that tails mcp.log inside a running Claude session). Different feature, different task.
- Testing MCP discovery from a truly blank `~/.claude` state. The harness requires an OAuth token, which implies prior login on any real user machine; discovery bugs would surface through normal use.
- Performance optimization. Nested Docker on macOS is slow (~2–3 minutes per run). Acceptable for a pre-release check.

## Architecture

Nested Docker. Three concentric layers:

```
Host (developer's Mac)
 └── Test container (agents-observe-test:local, --privileged, runs dockerd inside)
      └── Inner dockerd
           └── Server container (agents-observe:local, started by the plugin via MCP)
```

The test container is ephemeral: `docker run --privileged --rm`. When it exits, its inner dockerd dies, taking the inner server container with it. The host sees no leftover containers, no leftover volumes, no leftover plugin data directory. That isolation is the whole point of going nested rather than socket-mounted — a socket-mount (DooD) approach would leak state onto the host and defeat the "fresh install" semantics.

The test container contains everything a first-time user's machine needs: Node.js, `@anthropic-ai/claude-code` installed globally from npm, the plugin source copied in at `/plugin`, and a pre-saved server image tarball to load into the inner dockerd (avoids needing a registry for uncommitted code).

## Components

### `scripts/test-fresh-install.sh` (new)

The host-side driver. Steps:

1. **Preflight.** Verify `docker` is on PATH and responsive. Verify `AGENTS_OBSERVE_TEST_CLAUDE_OAUTH_TOKEN` is set (fail with a clear message if not).
2. **Build the server image.** `docker build -t agents-observe:local .` from the repo root. This is the image the plugin will run as the observability server.
3. **Save the server image.** `docker save agents-observe:local -o <tmpdir>/server-image.tar`. This tarball gets mounted into the test container so the inner dockerd can `docker load` it without needing registry access.
4. **Build the test image.** `docker build -t agents-observe-test:local -f test/fresh-install/Dockerfile .` with the repo root as context (so the Dockerfile can COPY the plugin source).
5. **Run the test container.** `docker run --privileged --rm -v <tmpdir>/server-image.tar:/server-image.tar:ro -e CLAUDE_CODE_OAUTH_TOKEN="$AGENTS_OBSERVE_TEST_CLAUDE_OAUTH_TOKEN" -e AGENTS_OBSERVE_TEST_SKIP_PULL=1 agents-observe-test:local`. The `--privileged` flag is required for the inner dockerd. Stdout/stderr stream live so the user sees progress.
6. **Cleanup.** Remove the tarball. Exit with the container's exit code.

The driver is a single bash script, under ~100 lines, dependency-free.

### `test/fresh-install/Dockerfile` (new)

The test container image. Based on `docker:dind` (Alpine + dockerd + Docker CLI). Additions:

- Install Node.js 24 via Alpine packages.
- `npm install -g @anthropic-ai/claude-code` — pins to whatever's latest at build time; rebuilds pick up new versions.
- `COPY . /plugin` — the plugin source from the repo root.
- `COPY test/fresh-install/entrypoint.sh /entrypoint.sh` and `chmod +x`.
- `ENTRYPOINT ["/entrypoint.sh"]`.

### `test/fresh-install/entrypoint.sh` (new)

Runs inside the test container. Steps:

1. **Start inner dockerd.** Launch `dockerd-entrypoint.sh &` (the standard `docker:dind` pattern). Poll `docker info` up to 60 seconds; abort with a clear error if it never comes up.
2. **Load the server image.** `docker load -i /server-image.tar`. Verify with `docker images | grep agents-observe` — abort if the image isn't present after load.
3. **Run the smoke test.** Execute `claude --plugin-dir /plugin -p "hello, this is a fresh install smoke test"`. Capture stdout and stderr to files. The `-p` flag makes claude run non-interactively (single prompt, print response, exit). When claude exits, the SessionStart → MCP spawn → startServer → event flow has had a chance to run end-to-end.
4. **Verification phase** (see §5). Each check writes its result to a structured results file.
5. **Diagnostics dump** (see §6). Unconditional on both success and failure.
6. **Exit.** Zero if all required verification checks passed; nonzero otherwise.

### `test/fresh-install/README.md` (new)

Short doc: what the harness tests, how to run it, required env vars, what to do if it fails, known gotchas (macOS performance, `--privileged` requirement, OAuth token quota).

### `.dockerignore` (new or updated)

Exclude `node_modules`, `data/`, `logs/`, `.git`, `app/client/node_modules`, `app/server/node_modules`, and any other build artifacts from the test container's build context. Keeps image build fast and avoids bloating the image with megabytes of unrelated state.

### `hooks/scripts/lib/config.mjs` (modified)

Add a new field to the exported config:

```js
testSkipPull: process.env.AGENTS_OBSERVE_TEST_SKIP_PULL === '1',
```

Two added lines.

### `hooks/scripts/lib/docker.mjs` (modified)

Modify `startServer()` to honor `config.testSkipPull` when deciding whether to `docker pull`:

```js
if (!config.testSkipPull) {
  const pullResult = await run('docker', ['pull', config.dockerImage])
  if (!pullResult.ok) {
    log.error(`Failed to pull image: ${pullResult.stderr}`)
    return null
  }
} else {
  log.info('AGENTS_OBSERVE_TEST_SKIP_PULL=1 — skipping docker pull (test harness)')
}
```

This is the entire production-code surface area of the feature. The `TEST_` prefix makes it unambiguously not-for-end-users, and we log when it's active so its effect is visible in `mcp.log` if anyone ever wonders why a pull was skipped.

## Verification checks

Four checks run inside `entrypoint.sh` after claude exits. Each prints a labeled PASS/FAIL line and captures supporting detail.

1. **Inner container exists.** `docker ps -a --filter name=agents-observe --format '{{.Status}}'` must show a running container. If not, the plugin's startup path failed outright.
2. **Server health endpoint.** `curl -sf http://127.0.0.1:4981/api/health` must return HTTP 200 with a JSON body containing `"ok": true`. The port is accessible from `entrypoint.sh` because both the inner container and the test container share the test container's network namespace (inner dockerd uses the default bridge inside the test container).
3. **SessionStart event captured.** `curl -sf http://127.0.0.1:4981/api/sessions/recent` must return at least one session with at least one event. We don't validate the payload structure — presence alone proves the hook → server path worked end-to-end, which is the whole point.
4. **No errors in mcp.log or cli.log.** Grep for `ERROR` lines in both `mcp.log` and `cli.log` (full paths depend on where `CLAUDE_PLUGIN_DATA` resolves inside the test container, almost certainly `/root/.agents-observe/logs/`). This is a soft check: errors are reported but don't fail the run unless checks 1–3 also fail. The value is catching partial failures that still produce a healthy container (e.g., version mismatches, transient hook failures, or errors logged by the CLI while the MCP path succeeded anyway).

Checks 1, 2, and 3 are *required*. Any failure → overall exit nonzero.

## Diagnostic output

Printed unconditionally at the end of every run, with clear section headers. Sections:

```
=== claude invocation ===
(exit code, stdout, stderr)

=== docker state (inside test container) ===
docker ps -a
docker images

=== docker logs agents-observe ===
(full inner server container logs)

=== mcp.log ===
(full contents, or "file not found" marker)

=== cli.log ===
(full contents, or "file not found" marker)

=== verification results ===
1. Inner container exists: PASS/FAIL — <detail>
2. Server health: PASS/FAIL — <detail>
3. SessionStart event captured: PASS/FAIL — <detail>
4. mcp.log errors: <count> line(s) matched /ERROR/
   cli.log errors: <count> line(s) matched /ERROR/

=== final status ===
PASS | FAIL
```

When the harness fails on the developer's machine, this output is self-contained: paste it into an issue and whoever's debugging has everything they need. That self-contained property is why the dump happens even on success — it normalizes the output and makes failure/success diffs meaningful.

## Environment variable contract

| Variable | Where read | Purpose | Required |
|---|---|---|---|
| `AGENTS_OBSERVE_TEST_CLAUDE_OAUTH_TOKEN` | `scripts/test-fresh-install.sh` (host) | Claude OAuth token. Driver remaps it to `CLAUDE_CODE_OAUTH_TOKEN` when starting the test container — that's the variable `claude` itself reads. | Yes |
| `AGENTS_OBSERVE_TEST_SKIP_PULL` | `hooks/scripts/lib/config.mjs` (inside test container, inside the plugin's MCP process) | When set to `1`, `startServer()` skips `docker pull`. Required for the local-image path because the locally-built image has no matching registry tag. | Set by the harness; not user-facing |

Both use the `AGENTS_OBSERVE_TEST_` prefix to signal test-only intent and avoid collision with any dev-time `.env` settings. A missing `AGENTS_OBSERVE_TEST_CLAUDE_OAUTH_TOKEN` produces a clear error from the driver script before any builds run.

Future test-only env vars (`AGENTS_OBSERVE_TEST_IMAGE_TAG`, `AGENTS_OBSERVE_TEST_TIMEOUT_SECONDS`, etc.) follow the same prefix rule.

## File layout

```
scripts/test-fresh-install.sh         # host driver (new)
test/fresh-install/Dockerfile         # test container image (new)
test/fresh-install/entrypoint.sh      # runs inside test container (new)
test/fresh-install/README.md          # short usage doc (new)
.dockerignore                         # exclude build artifacts (new or updated)
hooks/scripts/lib/config.mjs          # +2 lines for TEST_SKIP_PULL
hooks/scripts/lib/docker.mjs          # +5 lines to honor testSkipPull
```

Seven files, two of them single-purpose config additions, five of them new and scoped entirely under `test/fresh-install/` and `scripts/`.

## Known uncertainties (to resolve during implementation)

- **`claude --plugin-dir` flag name.** The flag is believed to be `--plugin-dir` but needs verification against the current `@anthropic-ai/claude-code` CLI help output. If it's different (e.g., `--plugin`, `--plugins`), the entrypoint adjusts accordingly. The existence of *some* such flag is load-bearing; if Claude Code has no way to load a plugin from a local directory, the harness can't work as designed and we'd have to fall back to writing to `~/.claude/plugins/` inside the test container manually.
- **Plugin discovery from `--plugin-dir`.** Need to confirm Claude actually picks up `.claude-plugin/plugin.json`, `.mcp.json`, and `hooks/hooks.json` from the given directory. First implementation step is a minimal "does claude see the MCP at all" check before wiring up the rest — if this fails, we triage before building more.
- **`mcp.log` path inside the test container.** `CLAUDE_PLUGIN_DATA` is set by Claude when it invokes the plugin; we don't know its exact value inside a DinD environment until we observe it. Expected to be `/root/.agents-observe/logs/mcp.log` or similar. The verification check greps a glob to be safe.
- **Port exposure from inner container.** The inner server container publishes port 4981 via `-p 4981:4981`. Inside the test container, `127.0.0.1:4981` should reach it because the inner dockerd's default bridge shares the test container's network namespace in the standard `docker:dind` setup. If this assumption is wrong, we use `docker inspect` to get the inner container's IP and hit it directly. Either way, the verification phase needs to tolerate both.

## Gotchas to document in `test/fresh-install/README.md`

- **`--privileged` requirement.** Nested dockerd needs it. Not appropriate for untrusted CI runners; fine for a developer machine.
- **macOS performance.** Docker Desktop on macOS is already a Linux VM. Running DinD inside it means dockerd-in-container-in-VM. Budget 2–3 minutes per end-to-end run.
- **OAuth token quota.** Each run makes a real API call to Anthropic using the provided token. Running the harness repeatedly consumes quota. The `-p` prompt is kept minimal to keep per-run cost negligible.
- **Image rebuild cost.** The server image rebuilds every run (via `docker build -t agents-observe:local .`). Docker's layer cache makes subsequent builds fast as long as source files haven't changed, but the first build after a clean checkout takes a few minutes.

## Success criteria

The harness is considered done when:

1. `./scripts/test-fresh-install.sh` runs to completion on the maintainer's Mac with `AGENTS_OBSERVE_TEST_CLAUDE_OAUTH_TOKEN` set.
2. On a clean checkout of the current tree, the run exits 0 and all three required verification checks (§5 items 1–3) pass. The soft mcp.log error check may report nonzero warnings without failing the run.
3. Deliberately breaking the startup path (e.g., temporarily corrupting `docker.mjs`) causes the run to exit nonzero AND the diagnostic dump clearly shows the failure cause in at least one of the captured logs.
4. The diagnostic output is self-contained enough that someone with no prior context can read it and understand whether the plugin started correctly.
5. Running the harness leaves no visible state on the host: no `agents-observe` container, no `agents-observe-test` container (both are `--rm`'d), no files in `~/.agents-observe/` that weren't there before.
