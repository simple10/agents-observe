---
name: observe
description: Agents Observe dashboard and server management
argument-hint: [status|start|stop|restart]
user_invocable: true
---

# /observe

Agents Observe dashboard and server management.

## Usage

- `/observe` — Open the dashboard URL
- `/observe status` — Show server health and config details
- `/observe start` — Start the server
- `/observe stop` — Stop the server
- `/observe restart` — Restart the server

## Instructions

The subcommand is in `$ARGUMENTS`. If empty, default to showing the dashboard URL.

### /observe (no args)

1. Run:
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/observe_cli.mjs health
   ```
2. If exit code 0: show the dashboard URL from the output.
3. If exit code 1: tell the user the server is not running and suggest `/observe start` or `/observe status`.

### /observe status

1. Run:
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/observe_cli.mjs health
   ```
2. Show the full output to the user (includes version, runtime, ports, log paths).
3. If the output contains "Version mismatch", tell the user and offer `/observe restart`.
4. If exit code 1, show the output and suggest `/observe start`.

### /observe start

1. Run:
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/observe_cli.mjs start
   ```
2. Show the output to the user. If successful, include the dashboard URL.

### /observe stop

1. Run:
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/observe_cli.mjs stop
   ```
2. Confirm to the user that the server has been stopped.

### /observe restart

1. Run:
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/observe_cli.mjs restart
   ```
2. Show the output to the user. If successful, include the dashboard URL.
