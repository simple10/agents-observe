---
name: observe-stop
description: Stop the Claude Observe server Docker container.
user_invocable: true
---

# /observe stop

Stop the Claude Observe Docker container.

## Instructions

1. Run this command to stop the server:
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/observe_cli.mjs server stop
   ```

2. If successful:
   - Tell the user: "Claude Observe server stopped. It will auto-restart on your next Claude Code session."

3. If it fails:
   - Tell the user the error output.
