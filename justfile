# Multi-Agent Observability System
# Usage: just <recipe>

set dotenv-load
set quiet

server_port := env("SERVER_PORT", "4000")
client_port := env("CLIENT_PORT", "5173")
project_root := justfile_directory()

# List available recipes
default:
    @just --list

# ─── System ──────────────────────────────────────────────

# Start the system (detached)
start:
    mkdir -p {{project_root}}/data
    cd {{project_root}} && SERVER_PORT={{server_port}} CLIENT_PORT={{client_port}} docker compose up -d --build

# Stop the system and reset the database
stop:
    cd {{project_root}} && docker compose down
    just db-reset

# Restart the system
restart: stop start

# View container logs (follow)
logs:
    cd {{project_root}} && docker compose logs -f

# ─── Database ────────────────────────────────────────────

# Clear SQLite WAL files
db-clean-wal:
    rm -f {{project_root}}/data/events.db-wal {{project_root}}/data/events.db-shm
    @echo "WAL files removed"

# Delete the entire events database
db-reset:
    rm -f {{project_root}}/data/events.db {{project_root}}/data/events.db-wal {{project_root}}/data/events.db-shm
    @echo "Database reset"

# ─── Testing ─────────────────────────────────────────────

# Send a test event to the server
test-event:
    curl -s -X POST http://localhost:{{server_port}}/events \
      -H "Content-Type: application/json" \
      -d '{"source_app":"test","session_id":"test-1234","hook_event_type":"PreToolUse","payload":{"tool_name":"Bash","tool_input":{"command":"echo hello"}}}' \
      | head -c 200
    @echo ""

# Check server and client health
health:
    @curl -sf http://localhost:{{server_port}}/health > /dev/null 2>&1 \
      && echo "Server: UP (port {{server_port}})" \
      || echo "Server: DOWN (port {{server_port}})"
    @curl -sf http://localhost:{{client_port}} > /dev/null 2>&1 \
      && echo "Client: UP (port {{client_port}})" \
      || echo "Client: DOWN (port {{client_port}})"

# ─── Hooks ───────────────────────────────────────────────

# Test a hook script directly (e.g. just hook-test pre_tool_use)
hook-test name:
    echo '{"session_id":"test-hook","tool_name":"Bash"}' | uv run {{project_root}}/.claude/hooks/{{name}}.py

# List all hook scripts
hooks:
    @ls -1 {{project_root}}/.claude/hooks/*.py | xargs -I{} basename {} .py

# ─── Open ────────────────────────────────────────────────

# Open the client dashboard in browser
open:
    open http://localhost:{{client_port}}
