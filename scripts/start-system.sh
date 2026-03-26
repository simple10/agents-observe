#!/bin/bash

echo "Starting Multi-Agent Observability System"
echo "==========================================="

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Get the directory of this script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
# Get the project root directory (parent of scripts)
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"

# Read ports from environment variables or use defaults
SERVER_PORT=${SERVER_PORT:-4001}
CLIENT_PORT=${CLIENT_PORT:-5174}

echo -e "${BLUE}Configuration:${NC}"
echo -e "  Server Port: ${GREEN}$SERVER_PORT${NC}"
echo -e "  Client Port: ${GREEN}$CLIENT_PORT${NC}"

# Ensure data directory exists
mkdir -p "$PROJECT_ROOT/data"

# Stop any existing containers
echo -e "\n${YELLOW}Stopping existing containers...${NC}"
cd "$PROJECT_ROOT"
docker compose down >/dev/null 2>&1 || true

# Build and start all services
echo -e "\n${GREEN}Building and starting containers...${NC}"
cd "$PROJECT_ROOT"
SERVER_PORT=$SERVER_PORT CLIENT_PORT=$CLIENT_PORT docker compose up -d --build

# Wait for server to be ready
echo -e "${YELLOW}Waiting for server to start...${NC}"
for i in {1..15}; do
    if curl -s http://localhost:$SERVER_PORT/api/projects >/dev/null 2>&1; then
        echo -e "${GREEN}Server is ready!${NC}"
        break
    fi
    sleep 1
done

# Wait for client to be ready
echo -e "${YELLOW}Waiting for client to start...${NC}"
for i in {1..15}; do
    if curl -s http://localhost:$CLIENT_PORT >/dev/null 2>&1; then
        echo -e "${GREEN}Client is ready!${NC}"
        break
    fi
    sleep 1
done

# Display status
echo -e "\n${BLUE}============================================${NC}"
echo -e "${GREEN}Multi-Agent Observability System Started${NC}"
echo -e "${BLUE}============================================${NC}"
echo
echo -e "Dashboard URL: ${GREEN}http://localhost:$CLIENT_PORT${NC}"
echo -e "Server API:    ${GREEN}http://localhost:$SERVER_PORT${NC}"
echo -e "WebSocket:     ${GREEN}ws://localhost:$SERVER_PORT/api/events/stream${NC}"
echo -e "Data dir:      ${GREEN}$PROJECT_ROOT/data${NC}"
echo
echo -e "To view logs:        ${YELLOW}just logs${NC}"
echo -e "To stop the system:  ${YELLOW}just stop${NC}"
