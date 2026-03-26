# Claude Observe - Multi-Agent Observability
# Usage: just <recipe>

set dotenv-load
set quiet

port := env("SERVER_PORT", "4001")
project_root := justfile_directory()
server := project_root / "app" / "server"
client := project_root / "app" / "client"

# List available recipes
default:
    @just --list

# ─── Docker ─────────────────────────────────────────────

# Start production containers (detached)
start:
    @mkdir -p {{project_root}}/data
    @docker compose down >/dev/null 2>&1 || true
    docker compose up -d --build
    @echo ""
    @echo "Waiting for server..."
    @for i in $(seq 1 15); do \
      if curl -sf http://localhost:{{port}}/api/projects >/dev/null 2>&1; then \
        echo "Ready: http://localhost:{{port}}"; \
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
    @echo "Starting dev server + client..."
    @echo "Server: http://localhost:{{port}}"
    @echo "Client: http://localhost:5174 (Vite dev)"
    @echo ""
    cd {{server}} && npm run dev &
    cd {{client}} && npm run dev &
    @wait

# Start only the server (dev mode with hot reload)
dev-server:
    cd {{server}} && npm run dev

# Start only the client (Vite dev server)
dev-client:
    cd {{client}} && npm run dev

# Build the client for production
build:
    cd {{client}} && npm run build

# ─── Testing ────────────────────────────────────────────

# Run server tests
test:
    cd {{server}} && npm test

# Run server tests in watch mode
test-watch:
    cd {{server}} && npm run test:watch

# Send a test event to the server
test-event:
    @echo '{"session_id":"test-1234","hook_event_name":"SessionStart","cwd":"/tmp","source":"new"}' \
      | CLAUDE_OBSERVE_PROJECT_NAME=test-project CLAUDE_OBSERVE_EVENTS_ENDPOINT=http://127.0.0.1:{{port}}/api/events node {{project_root}}/app/hooks/send_event.mjs
    @echo "Event sent"

# ─── Database ────────────────────────────────────────────

# Delete the events database
db-reset:
    rm -f {{project_root}}/data/observe.db {{project_root}}/data/observe.db-wal {{project_root}}/data/observe.db-shm
    @echo "Database reset"

# ─── Utilities ───────────────────────────────────────────

# Check server health
health:
    @curl -sf http://localhost:{{port}}/api/projects > /dev/null 2>&1 \
      && echo "Server: UP (http://localhost:{{port}})" \
      || echo "Server: DOWN (port {{port}})"

# Open the dashboard in browser
open:
    open http://localhost:{{port}}

# Format all source files
fmt:
    cd {{server}} && npm run fmt
    cd {{client}} && npm run fmt

# Install all dependencies
install:
    cd {{server}} && npm install
    cd {{client}} && npm install
