# Agents Observe

Real-time observability dashboard for Claude Code agents.

Includes powerful filtering, searching, and visualization of multi-agent sessions.

<p align="center">
  <a href="https://raw.githubusercontent.com/simple10/agents-observe/videos/docs/assets/dashboard.gif">
    <img src="https://raw.githubusercontent.com/simple10/agents-observe/videos/docs/assets/dashboard.gif" alt="Claude Observe Dashboard Demo" />
  </a>
</p>

<p>
<a href="https://raw.githubusercontent.com/simple10/agents-observe/videos/docs/assets/demo.mp4">Demo video</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/simple10/agents-observe/main/docs/assets/dashboard2.png" alt="Claude Observe Dashboard Screenshot - Expanded Row" />
</p>

The server and dashboard run locally or remotely, allowing multiple Claude Code instances to log full session data using hooks.

Hooks are used instead of OTEL to capture the full picture of agent actions.

## Plugin Installation

### Prerequisites

- [Docker](https://www.docker.com/) (required — the server runs as a container)
- [Node.js](https://nodejs.org/) (required — hook scripts run via `node`)

### Install

1. Add the marketplace:

   ```bash
   claude plugin marketplace add simple10/agents-observe
   ```

2. Install the plugin:

   ```bash
   claude plugin install agents-observe
   ```

3. Restart Claude Code.

That's it. On your next session, the server auto-starts as a Docker container and hooks begin capturing events. Open **<http://localhost:4981>** to see the dashboard.

## Plugin Skills

| Skill | Description |
|-------|-------------|
| `/observe` | Open the dashboard URL and check if the server is running |
| `/observe status` | Check server health and show dashboard URL |

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

The hook script is a dumb pipe — it reads the raw event from stdin, adds the project name, and POSTs it to the server. The server parses events, stores agent metadata (name, type, parentage), and forwards events to subscribed WebSocket clients. The React dashboard derives all agent state (status, event counts, timing) from the event stream — the server is a dumb store.

## Standalone Installation

> For development or running without the plugin. If you installed via the plugin above, skip this section.

### 1. Clone and install dependencies

```bash
git clone https://github.com/simple10/agents-observe.git agents-observe
cd agents-observe

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
| `AGENTS_OBSERVE_PROJECT_SLUG` | (auto-detected) | Project slug shown in the dashboard URL. If not set, derived from the session transcript path. |
| `AGENTS_OBSERVE_API_BASE_URL` | `http://127.0.0.1:4981/api` | Full URL for the events endpoint |

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
just dev-client       # Start only the client
just dev-client-build # Build the client for production
just test             # Run all tests (server + client)
just test-event   # Send a test event to the server
just fmt          # Format all source files

# Docker Container Commands:
just build        # Build the Docker image locally
just start        # Start production containers (Docker, detached)
just stop         # Stop Docker containers
just restart      # Restart Docker containers
just logs         # Follow Docker container logs

# Local Server Commands:
# Starts the server as a single process for API & client without docker
just start-local  # Builds client and runs local server (without docker)
npm run start     # Same as `just start-local`

# Setup & Utilities:
just setup-hooks <name>  # Generate hooks config for a project
just health              # Check server health
just cli <command>       # Run the CLI (hook, health, start, stop, restart)
just db-reset            # Delete the events database
just open                # Open the dashboard in browser
```

## Project structure

```text
app/
  server/                    # Node server — Hono routes, SQLite, WebSocket
  client/                    # React 19 + shadcn dashboard
hooks/
  hooks.json                 # Plugin hook definitions
  scripts/                   # CLI, MCP server, and shared libs
skills/                      # /observe and /observe status skills
scripts/                     # Release tooling
test/                        # Integration tests
data/                        # SQLite database (auto-created)
docs/                        # Screenshots and demo assets
.claude-plugin/              # Plugin + marketplace manifests
.env                         # Env config options used by cli & local server
.mcp.json                    # MCP server configuration
Dockerfile                   # Production container image
docker-compose.yml           # Container orchestration
justfile                     # Task runner commands
start.mjs                    # Docker container entrypoint
settings.template.json       # Hooks config template for setup-hooks
vitest.config.ts             # Test configuration
package.json                 # Version metadata and workspace scripts
```

## How it works

**Hooks** fire on every Claude Code event (tool calls, prompts, stops, subagent lifecycle). The hook script reads the raw event from stdin, adds the project name, and POSTs it to the server. If the server needs additional data (like the session's human-readable slug), it responds with a request — the hook reads it from the local transcript file and sends it back.

**Server** receives raw events, extracts structural fields (type, tool name, agent ID), stores agent metadata (name, description, type, parentage), and saves everything in SQLite. Events are forwarded to WebSocket clients subscribed to the relevant session — each browser tab only receives events for the session it's viewing. The server tracks session status (active/stopped) but does not track agent status.

**Client** fetches events via REST API on initial load, then receives real-time updates via WebSocket (events are appended to the local cache — no refetching). All agent state (status, event counts, timing) is derived from the event stream. Tool events are deduped client-side (PreToolUse + PostToolUse merged into a single row). The emoji icon mapping and summary generation are editable config files.

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
docker stop agents-observe && docker rm agents-observe
```

**Plugin not capturing events?**

Run `/observe status` to check if the server is running. If the container doesn't exist, restart Claude Code. Check Docker logs with `docker logs agents-observe`.

**Events not appearing in the dashboard?**

1. **Is the server running?** Run `just health` to check.
2. **Is the hook script configured?** Run `just setup-hooks my-project` and verify the output matches your `.claude/settings.json`.
3. **Is `AGENTS_OBSERVE_PROJECT_SLUG` set?** If `AGENTS_OBSERVE_PROJECT_SLUG` is not set, the project is auto-detected from the session transcript path.
4. **Can the hook reach the server?** Run `just test-event` — if the event appears in the dashboard, the server is reachable.

**WebSocket disconnected?**

The client reconnects automatically every 3 seconds if the WebSocket connection drops. You'll see "Disconnected" in the sidebar footer. Events received during reconnection will appear once the connection is restored and the events are refetched.

**Database issues?**

Run `just db-reset` to delete the SQLite database and start fresh. The database is auto-created on the next server start.

## ROADMAP

- [ ] Add support for Codex
- [ ] Add support for OpenClaw
- [ ] Add support for pi-code agents

--

## Reference

- [Claude Hooks](https://code.claude.com/docs/en/hooks.md) - official list of currently supported hooks

## Related Projects

- [Agent Super Spy](https://github.com/simple10/agent-super-spy) - full observability stack for agents, can be run locally or remotely
- [Multi-Agent Observability System](https://github.com/disler/claude-code-hooks-multi-agent-observability) - inspired this project
- [Claude DevTools](https://github.com/matt1398/claude-devtools) - visualization for claude session files, requires running on local machine

## License

MIT
