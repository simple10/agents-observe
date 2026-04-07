# Agents Observe - Agent Instructions

Real-time observability dashboard for Claude Code agents. Captures every hook event and streams it to a live dashboard.

## Quick Start

### Plugin (recommended)

If agents-observe is installed as a plugin, hooks are already configured. The server auto-starts as a Docker container on session start. The dashboard is at **http://localhost:4981**.

Use `/observe` to open the dashboard. Other commands: `/observe status`, `/observe start`, `/observe stop`, `/observe restart`, `/observe logs`, `/observe debug`.

### Standalone (development)

Requires [just](https://github.com/casey/just), [Node.js](https://nodejs.org/), and [Docker](https://www.docker.com/).

```bash
just install   # install dependencies (server + client)
just dev       # start server + client with hot reload
```

- Dev client: http://localhost:5174 (Vite)
- Dev server: http://localhost:4981 (API)

To run via Docker instead:

```bash
just start     # build and start the Docker container
```

Dashboard: http://localhost:4981

### Configure hooks for a target project

Generate hooks config for a project, then copy the output into the project's `.claude/settings.json`:

```bash
just setup-hooks <project-slug>
```

### Verify

```bash
just health       # check server health
just test-event   # send a test event to the server
```

## Architecture

```
Claude Code Hooks  ->  hook.sh  ->  observe_cli.mjs  ->  API Server (SQLite)  ->  React Dashboard
    (stdin JSON)       (bash)       (HTTP POST)          (parse + store)         (WebSocket live)
```

- **Hooks** (`hooks/scripts/hook.sh`) read raw JSON from stdin and forward to `observe_cli.mjs`
- **CLI** (`hooks/scripts/observe_cli.mjs`) POSTs events to the server API
- **Server** (`app/server/`) Hono + SQLite + WebSocket
- **Client** (`app/client/`) React 19 + shadcn dashboard

In dev mode, client and server run as separate processes on separate ports. In production/Docker, the client is bundled and served by the server on port 4981.

## Common Commands

| Command | Description |
|---------|-------------|
| `just install` | Install all dependencies |
| `just dev` | Start server + client in dev mode (hot reload) |
| `just start` | Start the server (same path as plugin MCP) |
| `just stop` | Stop the server |
| `just restart` | Restart the server |
| `just test` | Run all tests |
| `just test-event` | Send a test event |
| `just health` | Check server health |
| `just fmt` | Format all source files |
| `just db-reset` | Delete the SQLite database (stops/restarts server) |
| `just logs` | Follow Docker container logs |
| `just open` | Open dashboard in browser |
| `just cli <cmd>` | Run CLI directly (hook, health, start, stop, restart, logs, db-reset) |
| `just setup-hooks <slug>` | Generate hooks config for a project |

## Project Structure

```
app/server/        # Hono server, SQLite, WebSocket
app/client/        # React 19 + shadcn dashboard
hooks/scripts/     # Hook script, CLI, MCP server
hooks/hooks.json   # Plugin hook definitions
skills/            # /observe skill (status, start, stop, restart, logs, debug)
test/              # Integration tests
data/              # SQLite database (auto-created)
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENTS_OBSERVE_SERVER_PORT` | `4981` | Server port (dev + Docker) |
| `AGENTS_OBSERVE_DEV_CLIENT_PORT` | `5174` | Vite dev client port |
| `AGENTS_OBSERVE_PROJECT_SLUG` | (auto-detected) | Project slug in dashboard URL |
| `AGENTS_OBSERVE_API_BASE_URL` | `http://127.0.0.1:4981/api` | API endpoint URL |
| `AGENTS_OBSERVE_LOG_LEVEL` | `debug` | Log level (`debug` or `trace`) |
| `AGENTS_OBSERVE_DATA_DIR` | `./data` | SQLite database directory |

## Worktrees

When using git worktrees for parallel development, each worktree needs its own ports to avoid conflicts with the main checkout.

Create a `.env` in the worktree root with unique ports:

```bash
AGENTS_OBSERVE_SERVER_PORT=4982
AGENTS_OBSERVE_DEV_CLIENT_PORT=5179
```

Pick any unused ports — just make sure they don't collide with the main checkout (4981/5174) or other worktrees. The `.env` file is gitignored so it won't affect other checkouts.

Then run `just dev` or `just start` as normal — the justfile loads `.env` automatically.

## Code Style

- TypeScript throughout, avoid `any`
- Run `just fmt` before committing (Prettier)
- Hook scripts are dependency-free (Node.js built-ins only)
- Use kebab-case for file names
