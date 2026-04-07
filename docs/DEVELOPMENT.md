# Development Guide

Detailed reference for developing agents-observe locally. For quick start, see [AGENTS.md](../AGENTS.md).

## Architecture

```
Claude Code Hooks  ->  hook.sh  ->  observe_cli.mjs  ->  API Server (SQLite)  ->  React Dashboard
    (stdin JSON)       (bash)       (HTTP POST)          (parse + store)         (WebSocket live)
```

- **Hooks** (`hooks/scripts/hook.sh`) read raw JSON from stdin and forward to `observe_cli.mjs`
- **CLI** (`hooks/scripts/observe_cli.mjs`) POSTs events to the server API. Also handles `hook-sync`, `hook-autostart`, `health`, `start`, `stop`, `restart`, `logs`, `db-reset`.
- **MCP** (`hooks/scripts/mcp_server.mjs`) starts the Docker container and maintains a heartbeat. Claude spawns this when loading the plugin.
- **Server** (`app/server/`) Hono + SQLite + WebSocket
- **Client** (`app/client/`) React 19 + shadcn dashboard

In dev mode, client and server run as separate processes on separate ports. In production/Docker, the client is bundled and served by the server on port 4981.

## Commands

| Command | Description |
|---------|-------------|
| `just install` | Install all dependencies |
| `just dev` | Start server + client in dev mode (hot reload) |
| `just start` | Start the server (same path as plugin MCP) |
| `just stop` | Stop the server |
| `just restart` | Restart the server |
| `just build` | Build the Docker image locally |
| `just test` | Run all tests |
| `just test-event` | Send a test event |
| `just health` | Check server health |
| `just fmt` | Format all source files |
| `just db-reset` | Delete the SQLite database (stops/restarts server) |
| `just logs` | Follow Docker container logs |
| `just open` | Open dashboard in browser |
| `just cli <cmd>` | Run CLI directly |
| `just setup-hooks <slug>` | Generate hooks config for a project |

## Project Structure

```
app/server/        # Hono server, SQLite, WebSocket
app/client/        # React 19 + shadcn dashboard
hooks/scripts/     # Hook script, CLI, MCP server
  lib/             # Shared libs: config, docker, fs, http, hooks, callbacks, logger
hooks/hooks.json   # Plugin hook definitions
skills/            # /observe skill
scripts/           # Release and test harness scripts
test/              # Tests (mirrors hooks/scripts/lib structure)
docs/              # Plans, specs, and this file
.claude-plugin/    # Plugin + marketplace manifests
.mcp.json          # MCP server configuration
Dockerfile         # Production container image
docker-compose.yml # Reference compose file (not used by plugin)
justfile           # Task runner commands
start.mjs          # Local server entrypoint (non-Docker)
```

## Environment Variables

All env vars are read in `hooks/scripts/lib/config.mjs` (centralized — never read `process.env` elsewhere).

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENTS_OBSERVE_SERVER_PORT` | `4981` | Server port (dev + Docker) |
| `AGENTS_OBSERVE_DEV_CLIENT_PORT` | `5174` | Vite dev client port |
| `AGENTS_OBSERVE_RUNTIME` | `docker` | Runtime mode: `docker`, `local`, or `dev` |
| `AGENTS_OBSERVE_PROJECT_SLUG` | (auto-detected) | Project slug in dashboard URL |
| `AGENTS_OBSERVE_API_BASE_URL` | `http://127.0.0.1:4981/api` | API endpoint (set for remote servers) |
| `AGENTS_OBSERVE_LOG_LEVEL` | `warn` | Log level: `warn`, `debug`, or `trace` |
| `AGENTS_OBSERVE_DATA_DIR` | `<data-root>/data` | SQLite database directory |
| `AGENTS_OBSERVE_LOCAL_DATA_ROOT` | (auto-detected) | Root for data, logs, and port file |
| `AGENTS_OBSERVE_HOOK_STARTUP_TIMEOUT` | `30000` | Max ms for hook-autostart to wait for server |
| `AGENTS_OBSERVE_DOCKER_IMAGE` | `ghcr.io/simple10/agents-observe:v<version>` | Docker image override |
| `AGENTS_OBSERVE_DOCKER_CONTAINER_NAME` | `agents-observe` | Container name override |
| `AGENTS_OBSERVE_TEST_SKIP_PULL` | (unset) | Set to `1` to skip docker pull (test harness only) |

## Worktrees

When using git worktrees for parallel development, each worktree needs its own ports to avoid conflicts.

Create a `.env` in the worktree root:

```bash
AGENTS_OBSERVE_SERVER_PORT=4982
AGENTS_OBSERVE_DEV_CLIENT_PORT=5179
```

Pick any unused ports — don't collide with the main checkout (4981/5174) or other worktrees. The `.env` is gitignored. The justfile loads it automatically.

### Merging worktrees

Always merge main into the worktree first, test there, then merge back:

```bash
# From the worktree
git merge main           # bring in latest main changes
just test                # verify everything works together

# Then merge back
git checkout main
git merge --squash <branch>    # default: squash into one commit
git commit -m "feat: description of the feature"
```

Main should never be the first place where two branches meet — surface conflicts in the worktree where you can test them.

**Before merging, analyze the branch and recommend squash vs regular merge.** Run `git log --oneline main..<branch>` and assess:

1. **How many commits?** And are they independently meaningful, or development iteration (feat → fix typo → refactor → fix tests)?
2. **Would anyone ever revert a single commit independently?** If not, they should be squashed together.
3. **Is there a logical multi-step progression?** (e.g., "add config" → "add CLI" → "add UI" → "add tests" where each is a complete unit)
4. **How many files changed?** A squash of 5 files is easy to review; a squash of 30 files across unrelated areas might benefit from keeping commits.

Present the analysis with a clear recommendation and let the user decide.

**Default to squash merge.** Most branches are single-purpose feature work where the individual development commits (WIP, fix typo, try again) aren't meaningful history. One clean commit on main is easier to bisect, revert, and read in `git log`.

**Use a regular merge (`git merge <branch>`) when:**
- The branch has multiple logical steps that are each independently meaningful and potentially revertable
- The branch is a large refactor touching many files — keeping commits lets reviewers see the progression
- The branch commits have already been reviewed individually (e.g., PR with per-commit feedback)

## Code Style

- TypeScript throughout, avoid `any`
- Run `just fmt` before committing (Prettier)
- Hook scripts are dependency-free (Node.js built-ins only)
- Use kebab-case for file names
- Use [Conventional Commits](https://www.conventionalcommits.org/) — see [CLAUDE.md](../CLAUDE.md) for prefixes

## Releasing

```bash
scripts/release.sh <version>        # full release
scripts/release.sh --dry-run <version>  # test without committing
```

The release script generates a CHANGELOG.md entry via Claude, opens it in your editor for review, runs tests, builds the Docker image, runs the fresh install test harness, then commits, tags, and pushes. GitHub Actions builds the multi-arch image and creates the release.

## Testing

```bash
just test                           # all tests (server + client + hooks)
npx vitest run                      # hooks/scripts/lib tests only
cd app/client && npx vitest run     # client tests only
cd app/server && npm test           # server tests only
```

Fresh install test harness (requires Docker + OAuth token in `.env`):

```bash
scripts/test-fresh-install.sh
```

See [test/fresh-install/README.md](../test/fresh-install/README.md) for details.
