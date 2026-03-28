---
name: observe-status
description: Check the status of the Claude Observe server and Docker container.
user_invocable: true
---

# /observe status

Check the Claude Observe server status.

## Instructions

1. Run these commands to gather status:
   ```bash
   echo "=== Container Status ==="
   docker ps -a --filter name=claude-observe --format "Name: {{.Names}}\nStatus: {{.Status}}\nPorts: {{.Ports}}"
   echo ""
   echo "=== Health Check ==="
   node ${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "$(dirname "$0")")")}/hooks/scripts/send_event.mjs health 2>&1 || true
   ```
   If `CLAUDE_PLUGIN_ROOT` is not set, fall back to:
   ```bash
   curl -sf http://127.0.0.1:4981/api/health && echo "Server: healthy" || echo "Server: not responding"
   ```

2. Report the results to the user:
   - If container is running and healthy: "Claude Observe is running. Dashboard: http://localhost:4981"
   - If container exists but is stopped: "Claude Observe container exists but is stopped. Restart Claude Code or run `docker start claude-observe`."
   - If no container exists: "Claude Observe container not found. Restart Claude Code to auto-start it, or check that Docker is running."
   - If container is running but health check fails: "Claude Observe container is running but not responding. Check logs with `docker logs claude-observe`."
