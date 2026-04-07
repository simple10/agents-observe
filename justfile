# Agents Observe
# Usage: just <recipe>
#
# AGENTS_OBSERVE_SERVER_PORT & AGENTS_OBSERVE_DEV_CLIENT_PORT are read from .env
# Allows for overriding the default ports
# Server port is used for both local dev & docker starts
# Client port is only for local dev

set dotenv-load := true
set export := true
set quiet := true

port := env("AGENTS_OBSERVE_SERVER_PORT", "4981")
dev_client_port := env("AGENTS_OBSERVE_DEV_CLIENT_PORT", "5174")
project_root := justfile_directory()
server := project_root / "app" / "server"
client := project_root / "app" / "client"
cli_script := project_root / "hooks" / "scripts" / "observe_cli.mjs"
hook_script := project_root / "hooks" / "scripts" / "hook.sh"

# List available recipes
default:
    @just --list

# ─── Docker ─────────────────────────────────────────────

# Build the Docker image locally
build:
    docker build -t agents-observe:local .

# Start docker container (detached)
start:
    @mkdir -p {{ project_root }}/data
    @docker compose down >/dev/null 2>&1 || true
    @docker rm -f agents-observe >/dev/null 2>&1 || true
    docker compose up -d --build
    @echo ""
    @echo "Waiting for server..."
    @for i in $(seq 1 15); do \
      if curl -sf http://localhost:{{ port }}/api/health >/dev/null 2>&1; then \
        echo "Ready: http://localhost:{{ port }}"; \
        break; \
      fi; \
      sleep 1; \
    done
    @just open

# Start the server locally without docker
start-local:
    @mkdir -p {{ project_root }}/data
    npm run start

# Stop containers
stop:
    @docker compose down >/dev/null 2>&1 || true
    @docker rm -f agents-observe >/dev/null 2>&1 || true

# Restart containers
restart: stop start

# View container logs (follow)
logs:
    docker compose logs -f

# ─── Development ─────────────────────────────────────────

# Start local server + client in dev mode (hot reload)
dev:
    AGENTS_OBSERVE_RUNTIME=dev node {{ project_root }}/start.mjs

# ─── Testing ────────────────────────────────────────────

# Run all tests (server + client)
test:
    npm test

# Send a test event to the server
test-event:
    @echo '{"session_id":"test-1234","hook_event_name":"SessionStart","cwd":"/tmp","source":"new"}' \
      | AGENTS_OBSERVE_PROJECT_NAME=test-project node {{ project_root }}/hooks/scripts/observe_cli.mjs hook
    @echo "Event sent"

# ─── Database ────────────────────────────────────────────

# Delete the events database (stops server, deletes, restarts)
db-reset:
    node {{ cli_script }} db-reset

# ─── Utilities ───────────────────────────────────────────

# Generate hooks config for a project's .claude/settings.json
setup-hooks project_slug:
    #!/usr/bin/env bash
    hook_script="{{ hook_script }}"
    sed \
      -e "s|__PROJECT_SLUG__|{{ project_slug }}|g" \
      -e "s|__HOOK_SCRIPT__|${hook_script}|g" \
      "{{ project_root }}/settings.template.json"
    echo ""
    echo "Copy the above JSON into your project's .claude/settings.json"

# Check server health
health:
    node {{ cli_script }} health

# Run the CLI with a command (hook, health, start, stop, restart)
cli *args:
    node {{ cli_script }} {{ args }}

# Open the dashboard in browser
open port=port:
    open http://localhost:{{ port }}

# Format all source files
fmt:
    cd {{ server }} && npm run fmt
    cd {{ client }} && npm run fmt

# Tag and push a release (bumps versions, tests, builds, tags, pushes)
release version:
    {{ project_root }}/scripts/release.sh {{ version }}

# Install all dependencies
install:
    cd {{ server }} && npm install
    cd {{ client }} && npm install
