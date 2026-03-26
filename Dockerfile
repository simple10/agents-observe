FROM oven/bun:1.2.17

WORKDIR /app

# Install server dependencies
COPY app/server/package.json app/server/bun.lock* app/server/
RUN cd app/server && bun install

# Install client dependencies
COPY app/client/package.json app/client/package-lock.json* app/client/
RUN cd app/client && bun install

COPY . .

EXPOSE 4001 5174

CMD ["sh", "-c", "cd /app/app/server && bun src/index.ts & cd /app/app/client && bunx vite --host 0.0.0.0 --port 5174 & wait"]
