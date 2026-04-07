# Agents Observe

Real-time observability dashboard for Claude Code agents. Captures every hook event and streams it to a live dashboard.

## Install as Plugin

```bash
claude plugin marketplace add simple10/agents-observe
claude plugin install agents-observe
```

Restart Claude Code. The server auto-starts as a Docker container and the dashboard is at **http://localhost:4981**.

### Skills

| Command | Description |
|---------|-------------|
| `/observe` | Open the dashboard |
| `/observe status` | Server health and config |
| `/observe start` | Start the server |
| `/observe stop` | Stop the server |
| `/observe restart` | Restart the server |
| `/observe logs` | Show recent container logs |
| `/observe debug` | Diagnose server issues |

## Clone & Run

Requires [just](https://github.com/casey/just), [Node.js](https://nodejs.org/), and [Docker](https://www.docker.com/).

```bash
git clone https://github.com/simple10/agents-observe.git
cd agents-observe
just install   # install dependencies
just start     # start server via Docker
```

Dashboard: http://localhost:4981

For dev mode with hot reload: `just dev` (client at http://localhost:5174, API at http://localhost:4981).

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Server not running | Run `/observe start` or restart Claude Code |
| Docker not running | Start Docker Desktop, then `/observe start` |
| Port conflict | Set `AGENTS_OBSERVE_SERVER_PORT=<port>` in `.env` |
| Need diagnostics | Run `/observe debug` |
| Database issues | Run `just db-reset` |

## Development

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for architecture, commands, environment variables, worktrees, and code style.
