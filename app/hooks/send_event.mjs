// app/hooks/send_event.mjs
// Sends hook events to the server and handles server requests for local data.
// No dependencies -- uses only Node.js built-ins.

import { request } from 'node:http'
import { readFileSync } from 'node:fs'

const projectName = process.env.CLAUDE_OBSERVE_PROJECT_NAME
if (!projectName) {
  process.exit(0)
}

const eventsEndpoint =
  process.env.CLAUDE_OBSERVE_EVENTS_ENDPOINT || 'http://127.0.0.1:4001/api/events'
const endpointUrl = new URL(eventsEndpoint)
const baseUrl = endpointUrl.origin // e.g. http://127.0.0.1:4001

// ── HTTP helpers ──────────────────────────────────────────

function postJson(url, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data)
    const parsed = new URL(url)
    const req = request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 3000,
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => {
          data += chunk
        })
        res.on('end', () => {
          try {
            resolve(JSON.parse(data))
          } catch {
            resolve(null)
          }
        })
      },
    )
    req.on('error', () => resolve(null))
    req.on('timeout', () => {
      req.destroy()
      resolve(null)
    })
    req.write(body)
    req.end()
  })
}

// ── Command handlers ──────────────────────────────────────
// Each handler reads local data that the server can't access.

const commands = {
  getSessionSlug({ transcript_path }) {
    if (!transcript_path) return null
    try {
      // Read file and scan line by line for first slug reference
      const content = readFileSync(transcript_path, 'utf8')
      let pos = 0
      while (pos < content.length) {
        const nextNewline = content.indexOf('\n', pos)
        const end = nextNewline === -1 ? content.length : nextNewline
        const line = content.slice(pos, end).trim()
        pos = end + 1
        if (!line) continue
        // Quick check before parsing — skip lines without "slug"
        if (!line.includes('"slug"')) continue
        try {
          const entry = JSON.parse(line)
          if (entry.slug) return { slug: entry.slug }
        } catch {
          continue
        }
      }
    } catch {
      /* file not readable */
    }
    return null
  },
}

async function handleRequests(requests) {
  if (!Array.isArray(requests)) return
  for (const req of requests) {
    const handler = commands[req.cmd]
    if (!handler) continue
    const result = handler(req.args || {})
    if (result && req.callback) {
      await postJson(`${baseUrl}${req.callback}`, result)
    }
  }
}

// ── Main ──────────────────────────────────────────────────

let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  input += chunk
})
process.stdin.on('end', async () => {
  if (!input.trim()) process.exit(0)

  let payload
  try {
    payload = JSON.parse(input)
  } catch {
    process.exit(0)
  }

  payload.project_name = projectName

  const response = await postJson(eventsEndpoint, payload)

  // Handle server requests for local data
  if (response?.requests) {
    await handleRequests(response.requests)
  }

  process.exit(0)
})
