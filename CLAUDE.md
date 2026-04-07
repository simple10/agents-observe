See [AGENTS.md](./AGENTS.md) for instructions on using the plugin and dev server.

## Development

**Before developing features or modifying code, read [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).** It covers architecture, project structure, commands (`just dev`, `just test`, etc.), environment variables, worktree setup, code style, and testing.

Key points:
- Use `just dev` for hot-reload development, `just test` to run all tests
- Worktrees need a `.env` with unique ports (see DEVELOPMENT.md § Worktrees)
- All env vars are centralized in `hooks/scripts/lib/config.mjs` — never read `process.env` elsewhere
- TypeScript throughout, kebab-case file names, run `just fmt` before committing

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
