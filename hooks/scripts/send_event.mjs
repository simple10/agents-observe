// hooks/scripts/send_event.mjs
// CLI for Claude Observe plugin. Sends hook events, checks health.
// No dependencies - uses only Node.js built-ins.

import { request } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { readFileSync } from 'node:fs'

// -- Config -------------------------------------------------------

function parseArgs(args) {
  const parsed = { command: null, baseUrl: null, projectSlug: null }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--base-url' && args[i + 1]) {
      parsed.baseUrl = args[i + 1]
      i++
    } else if (args[i] === '--project-slug' && args[i + 1]) {
      parsed.projectSlug = args[i + 1]
      i++
    } else if (!parsed.command) {
      parsed.command = args[i]
    }
  }
  return parsed
}

const cliArgs = parseArgs(process.argv.slice(2))
const command = cliArgs.command || 'hook'

const baseUrl =
  cliArgs.baseUrl ||
  process.env.CLAUDE_OBSERVE_BASE_URL ||
  (() => {
    const endpoint =
      process.env.CLAUDE_OBSERVE_EVENTS_ENDPOINT || 'http://127.0.0.1:4981/api/events'
    return new URL(endpoint).origin
  })()

const projectSlugOverride =
  cliArgs.projectSlug || process.env.CLAUDE_OBSERVE_PROJECT_SLUG || null

const allowedCallbacks = (() => {
  const val = (process.env.CLAUDE_OBSERVE_ALLOW_LOCAL_CALLBACKS || 'all').trim().toLowerCase()
  if (val === 'all') return null // null means allow all
  return new Set(
    val
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
})()

// -- HTTP helpers -------------------------------------------------

function httpRequest(url, options, body) {
  const parsed = new URL(url)
  const transport = parsed.protocol === 'https:' ? httpsRequest : request
  return new Promise((resolve) => {
    const req = transport(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: options.method || 'GET',
        headers: options.headers || {},
        timeout: 5000,
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => {
          data += chunk
        })
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) })
          } catch {
            resolve({ status: res.statusCode, body: data })
          }
        })
      },
    )
    req.on('error', (err) => {
      resolve({ status: 0, body: null, error: err.message })
    })
    req.on('timeout', () => {
      req.destroy()
      resolve({ status: 0, body: null, error: 'timeout' })
    })
    if (body) req.write(body)
    req.end()
  })
}

function postJson(url, data) {
  const body = JSON.stringify(data)
  return httpRequest(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    },
    body,
  )
}

function getJson(url) {
  return httpRequest(url, { method: 'GET' }, null)
}

// -- Callback handlers --------------------------------------------

const callbackHandlers = {
  getSessionSlug({ transcript_path }) {
    if (!transcript_path) return null
    try {
      const content = readFileSync(transcript_path, 'utf8')
      let pos = 0
      while (pos < content.length) {
        const nextNewline = content.indexOf('\n', pos)
        const end = nextNewline === -1 ? content.length : nextNewline
        const line = content.slice(pos, end).trim()
        pos = end + 1
        if (!line || !line.includes('"slug"')) continue
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
    if (allowedCallbacks && !allowedCallbacks.has(req.cmd)) {
      console.warn(
        `[claude-observe] Blocked callback: ${req.cmd} (not in CLAUDE_OBSERVE_ALLOW_LOCAL_CALLBACKS)`,
      )
      continue
    }
    const handler = callbackHandlers[req.cmd]
    if (!handler) continue
    const result = handler(req.args || {})
    if (result && req.callback) {
      await postJson(`${baseUrl}${req.callback}`, result)
    }
  }
}

// -- Commands -----------------------------------------------------

async function hookCommand() {
  let input = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    input += chunk
  })
  process.stdin.on('end', async () => {
    if (!input.trim()) process.exit(0)

    let hookPayload
    try {
      hookPayload = JSON.parse(input)
    } catch {
      process.exit(0)
    }

    const envelope = {
      hook_payload: hookPayload,
      meta: {
        env: {},
      },
    }

    if (projectSlugOverride) {
      envelope.meta.env.CLAUDE_OBSERVE_PROJECT_SLUG = projectSlugOverride
    }

    const result = await postJson(`${baseUrl}/api/events`, envelope)

    if (result.status === 0) {
      console.warn(`[claude-observe] Server unreachable at ${baseUrl}: ${result.error}`)
      process.exit(0)
    }

    if (result.body?.requests) {
      await handleRequests(result.body.requests)
    }

    process.exit(0)
  })
}

async function healthCommand() {
  const result = await getJson(`${baseUrl}/api/health`)
  if (result.status === 200 && result.body?.ok) {
    console.log(`Claude Observe is running. Dashboard: ${baseUrl}`)
    process.exit(0)
  } else if (result.status === 0) {
    console.log(`Claude Observe server is not running at ${baseUrl}`)
    process.exit(1)
  } else {
    console.log(`Claude Observe server error: ${JSON.stringify(result.body)}`)
    process.exit(1)
  }
}

// -- Main ---------------------------------------------------------

switch (command) {
  case 'hook':
    hookCommand()
    break
  case 'health':
    healthCommand()
    break
  default:
    console.error(`Unknown command: ${command}`)
    console.error(
      'Usage: node send_event.mjs <hook|health> [--base-url URL] [--project-slug SLUG]',
    )
    process.exit(1)
}
