# Claude Observe

Real-time observability for Claude Code agents with powerful filtering, searching, and visualization of multi-agent sessions.

<p align="center">
  <img src="https://raw.githubusercontent.com/simple10/claude-observe/main/docs/assets/dashboard1.png" alt="Claude Observe Dashboard Screenshot" />
</p>
<p align="center">
  <img src="https://raw.githubusercontent.com/simple10/claude-observe/main/docs/assets/dashboard2.png" alt="Claude Observe Dashboard Screenshot - Expanded Row" />
</p>

The server and dashboard run locally or remotely, allowing multiple Claude Code instances to log full session data using hooks.

## Plugin Installation

### Prerequisites

- [Docker](https://www.docker.com/) (required — the server runs as a container)
- [Node.js](https://nodejs.org/) (required — hook scripts run via `node`)

### Install

1. Add the marketplace:

   ```bash
   claude plugin marketplace add simple10/claude-observe
   ```

2. Install the plugin:

   ```bash
   claude plugin install claude-observe
   ```

3. Restart Claude Code.

That's it. On your next session, the server auto-starts as a Docker container and hooks begin capturing events. Open **<http://localhost:4981>** to see the dashboard.

## Plugin Skills

| Skill | Description |
|-------|-------------|
| `/observe` | Open the dashboard URL and check if the server is running |
| `/observe stop` | Stop the Docker container (auto-restarts on next session) |
| `/observe status` | Show container status and server health |

## Why observability matters

When Claude Code runs autonomously — spawning subagents, calling tools, reading files, executing commands — you have no visibility into what's actually happening. The terminal shows a fraction of the activity. Subagents are invisible. Tool calls blur together. And when something goes wrong three agents deep in a parallel execution, you're left reading through logs after the fact.

Claude Observe captures every hook event as it happens and streams it to a live dashboard. You see exactly what each agent is doing, which tools it's calling, what files it's touching, and how subagents relate to their parents. In real time.

This matters because:

- **Multi-agent work is opaque.** A coordinator spawns a code reviewer, a test runner, and a documentation agent in parallel. Without observability, you only see the final result. With it, you watch each agent work and catch problems as they happen.
- **Tool calls are the ground truth.** The assistant's text output is a summary. The actual tool calls — the Bash commands, file reads, edits, grep patterns — tell you what Claude is really doing. Claude Observe shows you both.
- **Debugging is time travel.** When a subagent makes a bad edit or runs a destructive command, you need to trace back through the exact sequence of events. The event stream gives you that timeline with full payloads.
- **Sessions are ephemeral, but patterns aren't.** By capturing events across sessions, you can see how agents behave over time, which tools they favor, and where they get stuck.

## What you can do

- Watch tool calls stream in as they happen (PreToolUse → PostToolUse with results)
- See the full agent hierarchy — which subagent was spawned by which parent
- Filter by agent, tool type, or search across all events
- Expand any event to see the full payload, command, and result
- Click timeline icons to jump to specific events in the stream
- Browse historical sessions with human-readable names (e.g., "twinkly-hugging-dragon")

## Architecture

```
Claude Code Hooks  →  observe_cli.mjs  →  API Server (SQLite)  →  React Dashboard
    (dumb pipe)         (HTTP POST)        (parse + store)        (WebSocket live)
```

The hook script is a dumb pipe — it reads the raw event from stdin, adds the project name, and POSTs it to the server. The server parses events, builds the agent hierarchy, and broadcasts to connected clients via WebSocket. The React dashboard consumes the API and renders the event stream, timeline, and filters.

## Standalone Installation

> For development or running without the plugin. If you installed via the plugin above, skip this section.

### 1. Clone and install dependencies

```bash
git clone https://github.com/simple10/claude-observe.git claude-observe
cd claude-observe

# Install just if needed
brew install just

# Start the docker container
just start

# Or start local dev servers
just install
just dev
```

See [justfile](./justfile) for additional commands.

### 2. Configure Claude Code hooks

Generate the hooks config for your project:

```bash
just setup-hooks my-project
```

This prints a JSON snippet with all paths pre-filled. Copy it into your Claude Code settings at either:

- **Project-level** (recommended): `.claude/settings.json` in your project root
- **User-level** (all projects): `~/.claude/settings.json`

**Environment variables set in the config:**

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUDE_OBSERVE_PROJECT_SLUG` | (auto-detected) | Project slug shown in the dashboard URL. If not set, derived from the session transcript path. |
| `CLAUDE_OBSERVE_EVENTS_ENDPOINT` | `http://127.0.0.1:4981/api/events` | Full URL for the events endpoint |

### 3. Verify it works

```bash
# Check the server is running
just health

# Send a test event
just test-event
```

Navigate to **<http://localhost:5174>** (dev) or **<http://localhost:4981>** (Docker). You should see the test event appear. Start a Claude Code session in your configured project and events will stream in automatically.

## Standalone Commands

If you have [just](https://github.com/casey/just) installed:

```bash
# Local Dev Commands:
just install      # Install all dependencies
just dev          # Start server + client in dev mode (hot reload)
just dev-server   # Start only the server
just dev-client   # Start only the client
just test         # Run server tests
just test-watch   # Run server tests in watch mode
just test-event   # Send a test event to the server
just fmt          # Format all source files

# Docker Container Commands:
just start        # Start production containers (Docker, detached)
just stop         # Stop Docker containers
just restart      # Restart Docker containers
just logs         # Follow Docker container logs

# Setup & Utilities:
just setup-hooks <name>  # Generate hooks config for a project
just health              # Check server health
just db-reset            # Delete the events database
just open                # Open the dashboard in browser
```

## Project structure

```text
hooks/
  hooks.json                 # Plugin hook definitions
  scripts/
    observe_cli.mjs          # CLI — sends hook events, manages server
    manage_server.sh         # MCP server — manages Docker container
skills/
  observe/                   # /observe skill
  observe-stop/              # /observe stop skill
  observe-status/            # /observe status skill
.claude-plugin/
  plugin.json                # Plugin manifest
marketplace.json             # Self-hosted marketplace manifest
.mcp.json                    # MCP server configuration
app/
  server/                    # Node server — parses events, SQLite, WebSocket
    src/
      index.ts               # HTTP routes + WebSocket
      db.ts                  # SQLite schema + queries
      parser.ts              # Raw JSONL → structured event extraction
  client/                    # React 19 + shadcn dashboard
    src/
      components/
        sidebar/             # Project + session navigation
        main-panel/          # Scope bar, filters
        timeline/            # Activity swim lanes
        event-stream/        # Event rows + detail expansion
      config/
        event-icons.ts       # Emoji mapping (editable)
      lib/
        event-summary.ts     # Client-side summary generation
        agent-utils.ts       # Agent display names
      stores/
        ui-store.ts          # Zustand UI state + URL routing
      hooks/                 # TanStack Query data hooks + WebSocket
```

## How it works

**Hooks** fire on every Claude Code event (tool calls, prompts, stops, subagent lifecycle). The hook script reads the raw event from stdin, adds the project name, and POSTs it to the server. If the server needs additional data (like the session's human-readable slug), it responds with a request — the hook reads it from the local transcript file and sends it back.

**Server** receives raw events, extracts structural fields (type, tool name, agent ID), builds the agent hierarchy (parent → subagent relationships), stores everything in SQLite, and broadcasts new events to WebSocket clients. The server is the single source of truth — no formatting, no truncation, just raw data with structural indexes.

**Client** fetches data via REST API, receives real-time updates via WebSocket, and handles all display logic (summaries, truncation, deduplication, filtering). Tool events are deduped client-side (PreToolUse + PostToolUse merged into a single row). The emoji icon mapping and summary generation are editable config files.

### Dev vs Production

In dev mode, the client and server run as separate processes with separate ports.

In production or docker mode, the client is bundled and served by the server. Both the API and dashboard are served from the same process and port.

Both local dev and Docker flows default to using the same sqlite database in ./data. The database is auto created as needed.

## Troubleshooting

**Docker not running?**

The plugin requires Docker to run the server. Make sure Docker Desktop (or the Docker daemon) is running, then restart Claude Code.

**Port 4981 in use?**

If another process is using port 4981, stop it or remove a stale container:

```bash
docker stop claude-observe && docker rm claude-observe
```

**Plugin not capturing events?**

Run `/observe status` to check if the server is running. If the container doesn't exist, restart Claude Code. Check Docker logs with `docker logs claude-observe`.

**Events not appearing in the dashboard?**

1. **Is the server running?** Run `just health` to check.
2. **Is the hook script configured?** Run `just setup-hooks my-project` and verify the output matches your `.claude/settings.json`.
3. **Is `CLAUDE_OBSERVE_PROJECT_SLUG` set?** If `CLAUDE_OBSERVE_PROJECT_SLUG` is not set, the project is auto-detected from the session transcript path.
4. **Can the hook reach the server?** Run `just test-event` — if the event appears in the dashboard, the server is reachable.

**WebSocket disconnected?**

The client automatically falls back to polling every 3 seconds if the WebSocket connection fails. You'll see "Disconnected" in the sidebar — events still appear, just with a slight delay.

**Database issues?**

Run `just db-reset` to delete the SQLite database and start fresh. The database is auto-created on the next server start.

## Related Projects

- [Agent Super Spy](https://github.com/simple10/agent-super-spy) - full observability stack for agents, can be run locally or remotely
- [Multi-Agent Observability System](https://github.com/disler/claude-code-hooks-multi-agent-observability) - inspired this project
- [Claude DevTools](https://github.com/matt1398/claude-devtools) - visualization for claude session files, requires running on local machine

## License

MIT
