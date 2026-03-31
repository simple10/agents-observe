---
name: observe-status
description: Check the status of the Claude Observe server.
user_invocable: true
---

# /observe status

Check the Claude Observe server status.

## Instructions

1. Run this command to check the server health:
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/observe_cli.mjs health
   ```

2. If the server is running (exit code 0):
   - Show the output to the user (includes version and dashboard URL).
   - If the output contains "Version mismatch", tell the user about the mismatch and offer to restart the server.

3. If the user wants to restart/update the server, run:
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/observe_cli.mjs restart
   ```

4. If the server is not running (exit code 1):
   - Show the output to the user.
   - Tell the user: "The MCP server manages the Docker container automatically. To restart it, use `/mcp` and re-enable the `agents-observe` MCP server, or restart Claude Code."
   - Do NOT attempt to start the server yourself — it is managed by the MCP lifecycle.
