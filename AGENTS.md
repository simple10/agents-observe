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

**Before developing features or modifying code, read [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).** It covers architecture, project structure, commands (`just dev`, `just test`, etc.), environment variables, worktree setup, code style, and testing.

Key points:
- Use `just dev` for hot-reload development
- **Run `just check` before every commit** — runs all tests + formatting
- Use `just` commands for all dev tasks (not `npm` directly) — see `just --list`
- Worktrees need a `.env` with unique ports (see DEVELOPMENT.md § Worktrees)
- All env vars are centralized in `hooks/scripts/lib/config.mjs` — never read `process.env` elsewhere
- TypeScript throughout, kebab-case file names

## Commit Convention

Use [Conventional Commits](https://www.conventionalcommits.org/) for all commit messages. The release script uses `git log` to generate CHANGELOG.md entries via Claude, and consistent prefixes help it categorize changes accurately.

**Format:** `<type>: <description>`

| Prefix | Use for |
|--------|---------|
| `feat:` | New features or capabilities |
| `fix:` | Bug fixes |
| `docs:` | Documentation changes |
| `style:` | CSS, formatting, visual changes (no logic change) |
| `refactor:` | Code restructuring (no behavior change) |
| `test:` | Adding or updating tests |
| `chore:` | Build scripts, tooling, dependencies, config |
| `release:` | Version bumps (used by `scripts/release.sh`) |

**Examples:**
```
feat: add X button to clear search query
fix: timeline dots animating at different speeds
style: add cursor-pointer to clickable sidebar elements
refactor: replace per-dot transitions with container animation
chore: update release script with changelog generation
docs: document fresh install test harness usage
```

Breaking changes: add `!` after the type (e.g., `feat!: rename config namespace`).
