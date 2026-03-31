# Claude Observe
# Usage: just <recipe>
#
# CLAUDE_OBSERVE_SERVER_PORT & CLAUDE_OBSERVE_CLIENT_PORT are read from .env
# Allows for overriding the default ports
# Server port is used for both local dev & docker starts
# Client port is only for local dev

set dotenv-load := true
set export := true
set quiet := true

port := env("CLAUDE_OBSERVE_SERVER_PORT", "4981")
dev_client_port := env("CLAUDE_OBSERVE_CLIENT_PORT", "5174")
project_root := justfile_directory()
server := project_root / "app" / "server"
client := project_root / "app" / "client"

# List available recipes
default:
    @just --list

# ─── Docker ─────────────────────────────────────────────

# Build the Docker image locally
build:
    docker build -t claude-observe:local .

# Start production containers (detached)
start:
    @mkdir -p {{ project_root }}/data
    @docker compose down >/dev/null 2>&1 || true
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

# Stop containers
stop:
    docker compose down

# Restart containers
restart: stop start

# View container logs (follow)
logs:
    docker compose logs -f

# ─── Development ─────────────────────────────────────────

# Start server + client in dev mode (hot reload)
dev:
    #!/usr/bin/env bash
    echo "Starting dev server + client..."
    echo "Server: http://localhost:{{ port }}"
    echo "Client: http://localhost:{{ dev_client_port }} (Vite dev)"
    echo ""
    cd {{ server }} && npm run dev &
    pid1=$!
    cd {{ client }} && npm run dev &
    pid2=$!
    trap 'kill $pid1 $pid2 2>/dev/null; wait $pid1 $pid2 2>/dev/null; exit 0' INT TERM
    sleep 1
    just open {{ dev_client_port }}
    wait

# Start only the server (dev mode with hot reload)
dev-server:
    cd {{ server }} && npm run dev

# Start only the client (Vite dev server)
dev-client:
    cd {{ client }} && npm run dev

# Build the client for production - not needed if using docker
dev-client-build:
    cd {{ client }} && npm run build

# ─── Testing ────────────────────────────────────────────

# Run all tests (server + client)
test:
    npm test

# Send a test event to the server
test-event:
    @echo '{"session_id":"test-1234","hook_event_name":"SessionStart","cwd":"/tmp","source":"new"}' \
      | CLAUDE_OBSERVE_PROJECT_NAME=test-project node {{ project_root }}/hooks/scripts/observe_cli.mjs
    @echo "Event sent"

# ─── Database ────────────────────────────────────────────

# Delete the events database
db-reset:
    rm -f {{ project_root }}/data/observe.db {{ project_root }}/data/observe.db-wal {{ project_root }}/data/observe.db-shm
    @echo "Database reset"

# ─── Utilities ───────────────────────────────────────────

# Generate hooks config for a project's .claude/settings.json
setup-hooks project_slug:
    #!/usr/bin/env bash
    hook_script="{{ project_root }}/hooks/scripts/observe_cli.mjs"
    sed \
      -e "s|__PROJECT_SLUG__|{{ project_slug }}|g" \
      -e "s|__HOOK_SCRIPT__|${hook_script}|g" \
      "{{ project_root }}/settings.template.json"
    echo ""
    echo "Copy the above JSON into your project's .claude/settings.json"

# Check server health
health:
    @curl -sf http://localhost:{{ port }}/api/health > /dev/null 2>&1 \
      && echo "Server: UP (http://localhost:{{ port }})" \
      || echo "Server: DOWN (port {{ port }})"

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
