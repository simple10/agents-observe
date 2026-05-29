---
name: observe
description: Agents Observe dashboard and server management
argument-hint: [view|stats|status|start|stop|restart|logs-server|logs-cli|logs-mcp|debug]
user_invocable: true
---

# /observe

Agents Observe dashboard and server management.

## Usage

- `/observe view` — Open the current session in the dashboard
- `/observe stats` — Open the current session's stats modal in the dashboard
- `/observe` — Open the dashboard URL
- `/observe status` — Show server health and config details
- `/observe start` — Start the server
- `/observe stop` — Stop the server
- `/observe restart` — Restart the server
- `/observe logs-server` — Show recent Docker container logs
- `/observe logs-cli` — Tail the local cli.log file
- `/observe logs-mcp` — Tail the local mcp.log file
- `/observe debug` — Diagnose server issues (health, docker logs, mcp.log, cli.log)

## Instructions

All commands are invoked via the wrapper at `scripts/cli.sh`, which resolves the path to `observe_cli.mjs` relative to this skill's install location. Do not reach outside the skill dir with `../` paths — the agentskills spec disallows it and it breaks portability across agents.

The subcommand is in `$ARGUMENTS`. If empty, default to showing the dashboard URL.

### /observe view

Opens the current session in the dashboard.

1. Run health to get the dashboard origin:
   ```bash
   scripts/cli.sh health
   ```
2. From the output, take the `Dashboard:` URL (e.g. `http://localhost:4981`). If exit code 1, the server isn't running — tell the user to run `/observe start` and stop here.
3. Construct the session URL: `<dashboard>/#/_/${CLAUDE_SESSION_ID}` (the `_` is the project placeholder; the dashboard resolves the real project from the session id).
4. Open it in the user's default browser using the platform-appropriate command — `open <url>` on macOS, `xdg-open <url>` on Linux, `start <url>` on Windows. Pick based on the `Platform:` line in your environment context.
5. Also print the URL in your response so the user can re-open it if needed.

### /observe stats

Opens the current session's stats modal in the dashboard, using a deep-link URL.

1. Run health to get the dashboard origin:
   ```bash
   scripts/cli.sh health
   ```
2. From the output, take the `Dashboard:` URL (e.g. `http://localhost:4981`). If exit code 1, the server isn't running — tell the user to run `/observe start` and stop here.
3. Construct the deep link: `<dashboard>/#/_/${CLAUDE_SESSION_ID}:session.stats`
4. Open it in the user's default browser using the platform-appropriate command — `open <url>` on macOS, `xdg-open <url>` on Linux, `start <url>` on Windows. Pick based on the `Platform:` line in your environment context.
5. Also print the URL in your response so the user can re-open it if needed.

### /observe (no args)

1. Run:
   ```bash
   scripts/cli.sh health
   ```
2. If exit code 0: show the dashboard URL from the output.
3. If exit code 1: tell the user the server is not running and suggest `/observe start` or `/observe status`.

### /observe status

1. Run:
   ```bash
   scripts/cli.sh health
   ```
2. Show the full output to the user (includes version, runtime, ports, log paths).
3. If the output contains "Version mismatch", tell the user and offer `/observe restart`.
4. If exit code 1, show the output and suggest `/observe start`.

### /observe start

1. Run:
   ```bash
   scripts/cli.sh start
   ```
2. Show the output to the user. If successful, include the dashboard URL.

### /observe stop

1. Run:
   ```bash
   scripts/cli.sh stop
   ```
2. Confirm to the user that the server has been stopped.

### /observe restart

1. Run:
   ```bash
   scripts/cli.sh restart
   ```
2. Show the output to the user. If successful, include the dashboard URL.

### /observe logs-server

1. Run:
   ```bash
   scripts/cli.sh logs-server -n 50
   ```
2. Show the output to the user. Do NOT use `-f` (follow) — it would hang.

### /observe logs-cli

1. Run:
   ```bash
   scripts/cli.sh logs-cli -n 50
   ```
2. Show the output to the user.

### /observe logs-mcp

1. Run:
   ```bash
   scripts/cli.sh logs-mcp -n 50
   ```
2. Show the output to the user.

### /observe debug

Run these checks in sequence. Read each output before running the next — use what you learn to diagnose the issue.

1. **Server health:**
   ```bash
   scripts/cli.sh health
   ```

2. **Docker container logs (last 20 lines):**
   ```bash
   scripts/cli.sh logs-server -n 20
   ```

3. **MCP log (last 20 lines):**
   ```bash
   scripts/cli.sh logs-mcp -n 20
   ```

4. **CLI log (last 20 lines):**
   ```bash
   scripts/cli.sh logs-cli -n 20
   ```

5. **Analyze the results** and tell the user:
   - Is the server running? What version?
   - Are there errors in the docker logs? (look for crash loops, port conflicts, DB errors)
   - Are there errors in mcp.log? (look for startServer failures, image pull errors)
   - Are there errors in cli.log? (look for ECONNREFUSED, hook delivery failures)
   - Suggest specific fixes based on what you find.
