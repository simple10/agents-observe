FROM node:22-slim

WORKDIR /app

# Install server dependencies (includes native better-sqlite3)
COPY app/server/package*.json server/
RUN cd server && npm install

# Install client dependencies and build
COPY app/client/package*.json client/
RUN cd client && npm install
COPY app/client/ client/
# vite.config.ts reads ../../package.json (resolves to /package.json inside image)
COPY package.json /package.json
RUN cd client && npm run build

# Copy server source ONLY (not node_modules — those were built above for Linux)
COPY app/server/src server/src
COPY app/server/tsconfig.json server/

# Copy VERSION file for /api/health endpoint
COPY VERSION /app/VERSION

EXPOSE 4981

WORKDIR /app/server
CMD ["npx", "tsx", "src/index.ts"]
