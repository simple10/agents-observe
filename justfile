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

# List available recipes
default:
    @just --list

# ─── Docker ─────────────────────────────────────────────

# Build the Docker image locally
build:
    docker build -t agents-observe:local .

# Start server (same path as plugin MCP)
start:
    node {{ cli_script }} start
    @just open

# Start the server locally without docker
start-local:
    npm run start

# Stop server
stop:
    node {{ cli_script }} stop

# Restart server
restart:
    node {{ cli_script }} restart

# View container logs (follow)
logs:
    node {{ cli_script }} logs -f

# ─── Development ─────────────────────────────────────────

# Start local server + client in dev mode (hot reload)
dev:
    AGENTS_OBSERVE_RUNTIME=dev AGENTS_OBSERVE_SHUTDOWN_DELAY_MS=0 node {{ project_root }}/start.mjs

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

# Check server health
health:
    node {{ cli_script }} health

# Run the CLI with a command (hook, health, start, stop, restart)
cli *args:
    node {{ cli_script }} {{ args }}

# Open the dashboard in browser
open port=port:
    open http://localhost:{{ port }}

# Run all tests + format (run before every commit)
check:
    npm test
    npm run fmt

# Format all source files
fmt:
    npm run fmt

# Tag and push a release (bumps versions, tests, builds, tags, pushes)
release version:
    {{ project_root }}/scripts/release.sh {{ version }}

# Install all dependencies
install:
    cd {{ server }} && npm install
    cd {{ client }} && npm install
