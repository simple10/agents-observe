# Claude Observe

Real-time observability for Claude Code agents.

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
Claude Code Hooks  →  send_event.mjs  →  Bun Server (SQLite)  →  React Dashboard
    (dumb pipe)         (HTTP POST)        (parse + store)        (WebSocket live)
```

The hook script is a dumb pipe — it reads the raw event from stdin, adds the project name, and POSTs it to the server. The server parses events, builds the agent hierarchy, and broadcasts to connected clients via WebSocket. The React dashboard consumes the API and renders the event stream, timeline, and filters.

## Prerequisites

- [Bun](https://bun.sh/) (for the server)
- [Node.js](https://nodejs.org/) (for the client and hook script)
- [just](https://github.com/casey/just) (optional, for convenience commands)
- [Docker](https://www.docker.com/) (optional, for containerized deployment)

## Installation

### 1. Clone and install dependencies

```bash
git clone <repo-url> claude-observe
cd claude-observe

# Server
cd app/server && bun install && cd ../..

# Client
cd app/client && npm install && cd ../..
```

### 2. Configure Claude Code hooks

Copy the hooks configuration into your Claude Code settings. You can add it to either:

- **Project-level** (recommended): `.claude/settings.json` in your project root
- **User-level** (all projects): `~/.claude/settings.json`

Add the following to your settings file:

```json
{
  "env": {
    "CLAUDE_OBSERVE_PROJECT_NAME": "my-project",
    "CLAUDE_OBSERVE_EVENTS_ENDPOINT": "http://127.0.0.1:4001/api/events"
  },
  "hooks": {
    "PreToolUse": [
      { "matcher": "", "hooks": [{ "type": "command", "command": "node /path/to/claude-observe/app/hooks/send_event.mjs" }] }
    ],
    "PostToolUse": [
      { "matcher": "", "hooks": [{ "type": "command", "command": "node /path/to/claude-observe/app/hooks/send_event.mjs" }] }
    ],
    "Stop": [
      { "matcher": "", "hooks": [{ "type": "command", "command": "node /path/to/claude-observe/app/hooks/send_event.mjs" }] }
    ],
    "UserPromptSubmit": [
      { "matcher": "", "hooks": [{ "type": "command", "command": "node /path/to/claude-observe/app/hooks/send_event.mjs" }] }
    ],
    "SessionStart": [
      { "matcher": "", "hooks": [{ "type": "command", "command": "node /path/to/claude-observe/app/hooks/send_event.mjs" }] }
    ],
    "SubagentStop": [
      { "matcher": "", "hooks": [{ "type": "command", "command": "node /path/to/claude-observe/app/hooks/send_event.mjs" }] }
    ]
  }
}
```

Replace `/path/to/claude-observe` with the absolute path to where you cloned this repo.

**Environment variables:**

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUDE_OBSERVE_PROJECT_NAME` | (required) | Name shown in the dashboard for this project |
| `CLAUDE_OBSERVE_EVENTS_ENDPOINT` | `http://127.0.0.1:4001/api/events` | Full URL for the events endpoint |

### 3. Start the dashboard

**With just (recommended):**

```bash
# Start server + client locally
just dev-local

# Or with Docker
just start
```

**Without just:**

```bash
# Terminal 1: Server
cd app/server && bun src/index.ts

# Terminal 2: Client
cd app/client && npm run dev
```

### 4. Open the dashboard

Navigate to **http://localhost:5174** (dev) or **http://localhost:4001** (Docker).

Start a Claude Code session in your configured project. Events will stream into the dashboard automatically.

## Commands

If you have [just](https://github.com/casey/just) installed:

```
just dev-local    # Start server + client locally (no Docker)
just dev-server   # Start only the server
just dev-client   # Start only the client
just start        # Start with Docker (detached)
just dev          # Start with Docker + hot reload
just stop         # Stop Docker containers
just logs         # Follow Docker container logs
just test         # Run server tests
just test-event   # Send a test event to the server
just health       # Check if server and client are running
just db-reset     # Delete the events database
just open         # Open the dashboard in your browser
```

## Project structure

```
app/
  hooks/send_event.mjs    # Hook script — dumb pipe, forwards raw events
  server/                 # Bun server — parses events, SQLite, WebSocket
    src/
      index.ts            # HTTP routes + WebSocket
      db.ts               # SQLite schema + queries
      parser.ts           # Raw JSONL → structured event extraction
  client/                 # React 19 + shadcn dashboard
    src/
      components/
        sidebar/          # Project + session navigation
        main-panel/       # Scope bar, filters
        timeline/         # Activity swim lanes
        event-stream/     # Event rows + detail expansion
      config/
        event-icons.ts    # Emoji mapping (editable)
      lib/
        event-summary.ts  # Client-side summary generation
        agent-utils.ts    # Agent display names
      stores/
        ui-store.ts       # Zustand UI state + URL routing
      hooks/              # TanStack Query data hooks + WebSocket
```

## How it works

**Hooks** fire on every Claude Code event (tool calls, prompts, stops, subagent lifecycle). The hook script reads the raw event from stdin, adds the project name, and POSTs it to the server. If the server needs additional data (like the session's human-readable slug), it responds with a request — the hook reads it from the local transcript file and sends it back.

**Server** receives raw events, extracts structural fields (type, tool name, agent ID), builds the agent hierarchy (parent → subagent relationships), stores everything in SQLite, and broadcasts new events to WebSocket clients. The server is the single source of truth — no formatting, no truncation, just raw data with structural indexes.

**Client** fetches data via REST API, receives real-time updates via WebSocket, and handles all display logic (summaries, truncation, deduplication, filtering). Tool events are deduped client-side (PreToolUse + PostToolUse merged into a single row). The emoji icon mapping and summary generation are editable config files.

## License

MIT
