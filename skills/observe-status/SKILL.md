---
name: observe-status
description: Check the status of the Claude Observe server and Docker container.
user_invocable: true
---

# /observe status

Check the Claude Observe server status.

## Instructions

1. Run this command to check status:
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/observe_cli.mjs server status
   ```

2. Show the output to the user. The command checks both the Docker container status and the server health endpoint.
