# Multi-Agent Observability System
# Usage: just <recipe>

set dotenv-load
set quiet

server_port := env("SERVER_PORT", "4001")
client_port := env("CLIENT_PORT", "5174")
project_root := justfile_directory()

# List available recipes
default:
    @just --list

# ─── System ──────────────────────────────────────────────

# Start the system (detached)
start:
    ./scripts/start-system.sh

# Stop the system and reset the database
stop:
    cd {{project_root}} && docker compose down
    just db-reset

# Restart the system
restart: stop start

# View container logs (follow)
logs:
    cd {{project_root}} && docker compose logs -f

# ─── Development (local, no Docker) ─────────────────────

# Start server locally
dev-server:
    cd {{project_root}}/app/server && bun src/index.ts

# Start client locally
dev-client:
    cd {{project_root}}/app/client && npm run dev

# Start both server and client locally
dev:
    @echo "Starting server and client..."
    cd {{project_root}}/app/server && bun src/index.ts &
    cd {{project_root}}/app/client && npm run dev &
    @echo "Server: http://localhost:{{server_port}}"
    @echo "Client: http://localhost:{{client_port}}"
    wait

# Run server tests
test:
    cd {{project_root}}/app/server && bun test

# ─── Database ────────────────────────────────────────────

# Clear SQLite WAL files
db-clean-wal:
    rm -f {{project_root}}/data/events.db-wal {{project_root}}/data/events.db-shm
    rm -f {{project_root}}/app/server/app2.db-wal {{project_root}}/app/server/app2.db-shm
    @echo "WAL files removed"

# Delete the entire events database
db-reset:
    rm -f {{project_root}}/data/events.db {{project_root}}/data/events.db-wal {{project_root}}/data/events.db-shm
    rm -f {{project_root}}/app/server/app2.db {{project_root}}/app/server/app2.db-wal {{project_root}}/app/server/app2.db-shm
    @echo "Database reset"

# ─── Testing ─────────────────────────────────────────────

# Send a test event to the server
test-event:
    echo '{"sessionId":"test-1234","slug":"test-dragon","type":"user","message":{"role":"user","content":"hello world"},"timestamp":"2026-01-01T00:00:00Z"}' \
      | CLAUDE_OBSERVE_PROJECT_NAME=test-project CLAUDE_OBSERVE_PORT={{server_port}} node {{project_root}}/app/hooks/send_event.mjs
    @echo "Event sent"

# Check server and client health
health:
    @curl -sf http://localhost:{{server_port}}/api/projects > /dev/null 2>&1 \
      && echo "Server: UP (port {{server_port}})" \
      || echo "Server: DOWN (port {{server_port}})"
    @curl -sf http://localhost:{{client_port}} > /dev/null 2>&1 \
      && echo "Client: UP (port {{client_port}})" \
      || echo "Client: DOWN (port {{client_port}})"

# ─── Open ────────────────────────────────────────────────

# Open the client dashboard in browser
open:
    open http://localhost:{{client_port}}
