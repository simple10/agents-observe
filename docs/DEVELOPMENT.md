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
| `just check` | **Run before every commit** — tests + format |
| `just fmt` | Format all source files |
| `just db-reset` | Delete the SQLite database (stops/restarts server) |
| `just logs` | Follow Docker container logs |
| `just open` | Open dashboard in browser |
| `just cli <cmd>` | Run CLI directly |

## Project Structure

```
app/server/        # Hono server, SQLite, WebSocket
app/client/        # React 19 + shadcn dashboard
hooks/scripts/     # Hook script, CLI, MCP server
  lib/             # Shared libs: config, docker, fs, http, hooks, callbacks, logger
    agents/        # Agent-class-specific libs (claude-code, codex, unknown)
hooks/hooks.json   # Plugin hook definitions
skills/            # /observe skill
scripts/           # Release and test harness scripts
test/              # Tests (mirrors hooks/scripts structure)
docs/              # Plans, specs, and this file
.claude-plugin/    # Plugin + marketplace manifests
.mcp.json          # MCP server configuration
Dockerfile         # Production container image
docker-compose.yml # Reference compose file (not used by plugin)
justfile           # Task runner commands
start.mjs          # Local server entrypoint (non-Docker)
```

## Environment Variables

All CLI env vars are read in `hooks/scripts/lib/config.mjs`; server env
vars in `app/server/src/config.ts`; collector supervision env vars (shell,
unwired so far) in `hooks/scripts/supervision/lib/observe-env.sh`. For the
authoritative list of every env var the project reads, see
[`ENVIRONMENT.md`](./ENVIRONMENT.md).

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

## Timeline rendering perf

The activity timeline (`app/client/src/components/timeline/`) is the most performance-sensitive part of the client. On large sessions (5k+ historical events) it's trivially easy to regress live-mode CPU from ~10% to 100%+ with a small, innocent-looking change. **Profile CPU (DevTools Performance → record ~5s in live mode) on a busy session before committing any change to `activity-timeline.tsx`, `agent-lane.tsx`, `agent-label.tsx`, or anything they import.**

The two files have big banner comments at the top listing the specific gotchas; this section gives the why.

### Why it's fragile

`DotContainer` uses the Web Animations API to translate hundreds of event dots continuously. When everything is set up correctly the animation runs entirely on the compositor thread (GPU) and costs near-zero CPU. When something trips up layer promotion, the browser silently falls back to repainting the layer on the main thread every frame — that's the 100%+ CPU regression.

### Common traps

- **Opacity anywhere near the animating container.** Any `opacity < 1` (or `filter`, `backdrop-filter`, etc.) on a sibling or ancestor of `DotContainer` can cause the browser to merge their compositor layers. The AgentLane row uses absolute-positioned siblings (not a flex row) specifically so the name button's opacity stays isolated from the dots wrapper. Don't put both in the same flex cell.

- **Siblings inside the dots wrapper.** Tick marks live in their own absolute-positioned wrapper so `DotContainer` is the only child of its parent. Adding anything else to the dots wrapper forces the compositor to synchronize multiple layers per frame.

- **`visibility: hidden` instead of `display: none` on animated elements.** `visibility: hidden` keeps the CSS animation timeline running and any `will-change` layer allocated. Use `display: none` for anything that should truly go dormant between uses (see the Live/Rewind transition spinner).

- **Memoizing a slice that depends on `Date.now()`.** The `visibleEvents` computation in AgentLane is intentionally NOT memoized because its cutoff depends on wall-clock time. Memoizing it on `[events, rangeMs]` creates a classic stale-state bug: events age out of view but the slice stays non-empty, so `DotContainer` stays mounted and its Web Animation loops forever with nothing visible on screen.

- **Per-dot Radix Tooltips.** One shared Tooltip per lane with a moving anchor span is cheaper than N Tooltip context providers. The dot hover state is tracked in plain React state.

- **Missing React.memo on dot/agent rendering.** `useEffectiveEvents` returns a new array every WS flush and `useAgents` rebuilds Agent objects every flush, even when nothing in a lane has changed. `DotContainer` (length + trailing event id) and `AgentLabel` (agent field comparison) both need content-aware `React.memo` to skip unnecessary re-renders.

### When profiling

Look at the Performance flame graph:

- **"Composite Layers" dominant** → GPU path is working. CPU should be single digits.
- **"Paint" or "Layout" repeating every frame** → the compositor fell back to CPU rasterization. Something broke layer promotion.
- **`setAnchorTime` firing more than once per `rangeMs`** → the animation re-start loop is running too hot.
- **Live mode CPU similar with and without dots visible** → good sign; the animation alone shouldn't cost much.

## Specs and plans

Design docs and implementation plans live under `docs/`:

| Kind | Location while active | When done |
|------|-----------------------|-----------|
| Spec (design doc) | `docs/specs/` | Move to `docs/plans/implemented/` |
| Plan (step-by-step work) | `docs/plans/` | Move to `docs/plans/implemented/` |

A feature is "done" when its plan is fully implemented and the code has landed on `main`. At that point, move **both** the plan and its related spec into `docs/plans/implemented/` in the same commit so the two stay paired. Use `YYYY-MM-DD-<slug>.md` for the plan and `YYYY-MM-DD-<slug>-design.md` for the spec so they sort together.

Not every feature needs a dedicated plan — small, self-contained changes can ship from a spec alone. In that case still move the spec to `docs/plans/implemented/` once the feature ships.

## Code Style

- TypeScript throughout, avoid `any`
- Run `just check` before committing (runs all tests + Prettier)
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

**Before committing, always run `just check` from the project root.** This runs all tests and formats code. Do not skip this step or guess at which test commands to run in which directories.

```bash
just check                          # tests + format — run before every commit
just test                           # all tests only
just fmt                            # format only
```

Fresh install test harness (requires Docker + OAuth token in `.env`):

```bash
scripts/test-fresh-install.sh
```

See [test/fresh-install/README.md](../test/fresh-install/README.md) for details.
