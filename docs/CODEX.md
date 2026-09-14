# Codex integration

Agents Observe can install user-level Codex hooks so Codex sessions are observed from any working directory, including agents launched inside Firstmate project folders.

## Install globally

From the Agents Observe checkout:

```bash
just codex-hooks-install
```

This command merges Agents Observe handlers into `~/.codex/hooks.json`. It preserves unrelated hooks and records an identifiable marker on every inserted command so rerunning the installer is idempotent and uninstall removes only Agents Observe entries.

Codex hooks are enabled by default. Start Codex, open `/hooks`, and trust the newly installed command definitions. Codex stores trust against the exact hook definition, so moving the Agents Observe checkout or changing the generated command requires running the installer again and reviewing the changed hooks.

The installed commands call the absolute path to `hooks/scripts/hook.sh`, which makes them independent of the active project root. This is compatible with the planned spool/arm/watcher pipeline because that shared hook entrypoint remains the handoff boundary.

## Check status

```bash
just codex-hooks-status
```

## Uninstall

```bash
just codex-hooks-uninstall
```

Uninstall preserves all non-Agents-Observe hooks in the same file.

## Alternate Codex home

The installer supports an explicit Codex home path:

```bash
node scripts/codex-hooks.mjs install --codex-home /path/to/codex-home
```

## Events installed

The global installer registers the same event set currently used by the repository-local Codex integration:

- `SessionStart`
- `UserPromptSubmit`
- `PreToolUse`
- `PostToolUse`
- `Stop`

Every command sets `AGENTS_OBSERVE_AGENT_CLASS=codex` before invoking the shared hook entrypoint.
