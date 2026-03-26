// app/hooks/send_event.mjs
// Sends hook events to the server and handles server requests for local data.
// No dependencies -- uses only Node.js built-ins.

import { request } from 'node:http';
import { readFileSync } from 'node:fs';

const projectName = process.env.CLAUDE_OBSERVE_PROJECT_NAME;
if (!projectName) {
  process.exit(0);
}

const port = parseInt(process.env.CLAUDE_OBSERVE_PORT || '4001', 10);

// ── HTTP helpers ──────────────────────────────────────────

function postJson(path, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const req = request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 3000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch { resolve(null); }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}

// ── Command handlers ──────────────────────────────────────
// Each handler reads local data that the server can't access.

const commands = {
  getSessionSlug({ transcript_path }) {
    if (!transcript_path) return null;
    try {
      const content = readFileSync(transcript_path, 'utf8');
      // Slug is on the first line with a "slug" field
      for (const line of content.split('\n').slice(0, 20)) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          if (entry.slug) return { slug: entry.slug };
        } catch { continue; }
      }
    } catch { /* file not readable */ }
    return null;
  },
};

async function handleRequests(requests) {
  if (!Array.isArray(requests)) return;
  for (const req of requests) {
    const handler = commands[req.cmd];
    if (!handler) continue;
    const result = handler(req.args || {});
    if (result && req.callback) {
      await postJson(req.callback, result);
    }
  }
}

// ── Main ──────────────────────────────────────────────────

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', async () => {
  if (!input.trim()) process.exit(0);

  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    process.exit(0);
  }

  payload.project_name = projectName;

  const response = await postJson('/api/events', payload);

  // Handle server requests for local data
  if (response?.requests) {
    await handleRequests(response.requests);
  }

  process.exit(0);
});
