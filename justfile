# Claude Observe
# Usage: just <recipe>
#
# CLAUDE_OBSERVE_PORT & CLAUDE_OBSERVE_CLIENT_PORT are read from .env
# Allows for overriding the default ports
# Server port is used for both local dev & docker starts
# Client port is only for local dev

set dotenv-load := true
set quiet := true

port := env("CLAUDE_OBSERVE_PORT", "4981")
client_port := env("CLAUDE_OBSERVE_CLIENT_PORT", "5174")
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
    echo "Client: http://localhost:{{ client_port }} (Vite dev)"
    echo ""
    cd {{ server }} && npm run dev &
    pid1=$!
    cd {{ client }} && npm run dev &
    pid2=$!
    trap 'kill $pid1 $pid2 2>/dev/null; wait $pid1 $pid2 2>/dev/null; exit 0' INT TERM
    echo "let's do this!"
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
    cd {{ server }} && npm test
    cd {{ client }} && npm test

# Run all tests in watch mode
test-watch:
    #!/usr/bin/env bash
    cd {{ server }} && npm run test:watch &
    pid1=$!
    cd {{ client }} && npm run test:watch &
    pid2=$!
    trap 'kill $pid1 $pid2 2>/dev/null; wait $pid1 $pid2 2>/dev/null; exit 0' INT TERM
    wait

# Send a test event to the server
test-event:
    @echo '{"session_id":"test-1234","hook_event_name":"SessionStart","cwd":"/tmp","source":"new"}' \
      | CLAUDE_OBSERVE_PROJECT_NAME=test-project CLAUDE_OBSERVE_EVENTS_ENDPOINT=http://127.0.0.1:{{ port }}/api/events node {{ project_root }}/hooks/scripts/observe_cli.mjs
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
    hook_script="{{project_root}}/hooks/scripts/observe_cli.mjs"
    endpoint="http://127.0.0.1:{{port}}/api/events"
    sed \
      -e "s|__PROJECT_SLUG__|{{project_slug}}|g" \
      -e "s|__EVENTS_ENDPOINT__|${endpoint}|g" \
      -e "s|__HOOK_SCRIPT__|${hook_script}|g" \
      "{{project_root}}/settings.template.json"
    echo ""
    echo "Copy the above JSON into your project's .claude/settings.json"

# Check server health
health:
    @curl -sf http://localhost:{{ port }}/api/health > /dev/null 2>&1 \
      && echo "Server: UP (http://localhost:{{ port }})" \
      || echo "Server: DOWN (port {{ port }})"

# Open the dashboard in browser
open:
    open http://localhost:{{ port }}

# Format all source files
fmt:
    cd {{ server }} && npm run fmt
    cd {{ client }} && npm run fmt

# Tag and push a release (triggers GitHub Actions to build Docker image)
release version:
    #!/usr/bin/env bash
    set -euo pipefail
    v="{{version}}"
    if [ -z "$v" ]; then
      echo "Usage: just release <version>  (e.g. just release 1.0.0)"
      exit 1
    fi
    # Strip leading "v" if provided, then add it back
    v="${v#v}"
    tag="v${v}"
    if git rev-parse "$tag" >/dev/null 2>&1; then
      echo "Error: tag $tag already exists"
      exit 1
    fi
    if [ -n "$(git status --porcelain)" ]; then
      echo "Error: working directory is not clean — commit or stash changes first"
      exit 1
    fi
    just test
    just build
    echo "Creating release $tag..."
    git tag "$tag"
    git push origin "$tag"
    echo "Pushed $tag — GitHub Actions will build and publish the Docker image"
    echo "Watch: https://github.com/simple10/claude-observe/actions"

# Install all dependencies
install:
    cd {{ server }} && npm install
    cd {{ client }} && npm install
