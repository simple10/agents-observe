// hooks/scripts/observe_cli.mjs
// CLI for Claude Observe plugin. Sends hook events, checks health, manages server.
// No dependencies - uses only Node.js built-ins.

import { request } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { readFileSync } from 'node:fs'
import { execFile } from 'node:child_process'

// -- CLI Args -----------------------------------------------------

const cliArgs = parseArgs(process.argv.slice(2))
const command = cliArgs.commands[0] || 'hook'
const subCommand = cliArgs.commands[1] || null

// -- Set Vars -----------------------------------------------------

const pluginDataDir = process.env.CLAUDE_PLUGIN_DATA || `${process.env.HOME}/.claude-observe`
const mcpPortFile = `${pluginDataDir}/mcp-port`

function readMcpPort() {
  try {
    return readFileSync(mcpPortFile, 'utf8').trim() || null
  } catch {
    return null
  }
}

const serverPort = process.env.CLAUDE_OBSERVE_SERVER_PORT || '4981'
const savedPort = readMcpPort()
const apiBaseUrl =
  cliArgs.baseUrl ||
  process.env.CLAUDE_OBSERVE_API_BASE_URL ||
  (savedPort ? `http://127.0.0.1:${savedPort}/api` : `http://127.0.0.1:${serverPort}/api`)
const baseOrigin = new URL(apiBaseUrl).origin
const projectSlugOverride = cliArgs.projectSlug || process.env.CLAUDE_OBSERVE_PROJECT_SLUG || null
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

// Docker Config
const containerName = process.env.CLAUDE_OBSERVE_DOCKER_CONTAINER_NAME || 'claude-observe'
const dockerImage =
  process.env.CLAUDE_OBSERVE_DOCKER_IMAGE || 'ghcr.io/simple10/claude-observe:v0.5.0'
const dataDir = process.env.CLAUDE_OBSERVE_DATA_DIR || `${process.env.HOME}/.claude-observe/data`

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
      await postJson(`${baseOrigin}${req.callback}`, result)
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

    const result = await postJson(`${apiBaseUrl}/events`, envelope)

    if (result.status === 0) {
      console.warn(`[claude-observe] Server unreachable at ${baseOrigin}: ${result.error}`)
      process.exit(0)
    }

    if (result.body?.requests) {
      await handleRequests(result.body.requests)
    }

    process.exit(0)
  })
}

async function healthCommand() {
  const result = await getJson(`${apiBaseUrl}/health`)
  if (result.status === 200 && result.body?.ok) {
    console.log(`Claude Observe is running. Dashboard: ${baseOrigin}`)
    process.exit(0)
  } else if (result.status === 0) {
    console.log(`Claude Observe server is not running at ${baseOrigin}`)
    process.exit(1)
  } else {
    console.log(`Claude Observe server error: ${JSON.stringify(result.body)}`)
    process.exit(1)
  }
}

async function saveMcpPort(actualPort) {
  const { mkdirSync, writeFileSync } = await import('node:fs')
  mkdirSync(pluginDataDir, { recursive: true })
  writeFileSync(mcpPortFile, String(actualPort))
}

async function removeMcpPort() {
  try {
    const { unlinkSync } = await import('node:fs')
    unlinkSync(mcpPortFile)
  } catch {
    /* already gone */
  }
}

async function serverStartCommand() {
  // Check Docker availability
  const dockerCheck = await run('docker', ['info'])
  if (!dockerCheck.ok) {
    console.error('[claude-observe] Docker is not running or not installed')
    console.error('Install Docker: https://docs.docker.com/get-docker/')
    process.exit(1)
  }

  // Check if already healthy
  const healthResult = await getJson(`${apiBaseUrl}/health`)
  if (healthResult.status === 200 && healthResult.body?.ok) {
    console.log(`Server already running. Dashboard: ${baseOrigin}`)
    process.exit(0)
  }

  // Ensure data directory
  const { mkdirSync } = await import('node:fs')
  mkdirSync(dataDir, { recursive: true })

  // Remove stale container to ensure latest image
  const psResult = await run('docker', ['ps', '-a', '--format', '{{.Names}}'])
  if (psResult.ok && psResult.stdout.split('\n').includes(containerName)) {
    console.error('[claude-observe] Removing stopped container to pull latest image...')
    await run('docker', ['rm', containerName])
  }

  // Pull image
  console.error('[claude-observe] Pulling image and starting container...')
  const pullResult = await run('docker', ['pull', dockerImage])
  if (!pullResult.ok) {
    console.error(`[claude-observe] Failed to pull image: ${pullResult.stderr}`)
    process.exit(1)
  }

  // Try preferred port first, fall back to auto-assign if taken
  const preferredPort = serverPort
  const containerPort = '4981' // internal container port is always 4981

  let runResult = await run('docker', [
    'run', '-d',
    '--name', containerName,
    '-p', `${preferredPort}:${containerPort}`,
    '-e', `CLAUDE_OBSERVE_SERVER_PORT=${containerPort}`,
    '-e', 'CLAUDE_OBSERVE_DB_PATH=/data/observe.db',
    '-e', 'CLAUDE_OBSERVE_CLIENT_DIST_PATH=/app/client/dist',
    '-e', 'CLAUDE_OBSERVE_WEBSOCKET=true',
    '-v', `${dataDir}:/data`,
    dockerImage,
  ])

  let actualPort = preferredPort

  if (!runResult.ok && runResult.stderr.includes('port is already allocated')) {
    console.error(`[claude-observe] Port ${preferredPort} is in use, auto-assigning a free port...`)

    // Let Docker pick a random host port
    runResult = await run('docker', [
      'run', '-d',
      '--name', containerName,
      '-p', `0:${containerPort}`,
      '-e', `CLAUDE_OBSERVE_SERVER_PORT=${containerPort}`,
      '-e', 'CLAUDE_OBSERVE_DB_PATH=/data/observe.db',
      '-e', 'CLAUDE_OBSERVE_CLIENT_DIST_PATH=/app/client/dist',
      '-e', 'CLAUDE_OBSERVE_WEBSOCKET=true',
      '-v', `${dataDir}:/data`,
      dockerImage,
    ])

    if (!runResult.ok) {
      console.error(`[claude-observe] Failed to start container: ${runResult.stderr}`)
      process.exit(1)
    }

    // Read the assigned port
    const portResult = await run('docker', ['port', containerName, containerPort])
    if (portResult.ok) {
      // Output like "0.0.0.0:32768" or ":::32768"
      const match = portResult.stdout.match(/:(\d+)$/)
      if (match) actualPort = match[1]
    }
  } else if (!runResult.ok) {
    console.error(`[claude-observe] Failed to start container: ${runResult.stderr}`)
    process.exit(1)
  }

  // Save the actual port for hooks and CLI to discover
  await saveMcpPort(actualPort)

  // Wait for health
  const actualApiUrl = `http://127.0.0.1:${actualPort}/api`
  console.error('[claude-observe] Waiting for server to start...')
  for (let i = 0; i < 15; i++) {
    const h = await getJson(`${actualApiUrl}/health`)
    if (h.status === 200 && h.body?.ok) {
      console.error('[claude-observe] Server started successfully')
      console.log(`Dashboard: http://127.0.0.1:${actualPort}`)
      if (actualPort !== preferredPort) {
        console.error(`[claude-observe] Note: Using port ${actualPort} (preferred port ${preferredPort} was in use)`)
      }
      process.exit(0)
    }
    await new Promise((r) => setTimeout(r, 1000))
  }

  console.error('[claude-observe] Server failed to start within 15 seconds')
  console.error(`Check: docker logs ${containerName}`)
  process.exit(1)
}

async function serverStopCommand() {
  console.error('[claude-observe] Stopping server...')
  await run('docker', ['stop', containerName])
  await run('docker', ['rm', containerName])
  await removeMcpPort()
  console.log('Server stopped.')
  process.exit(0)
}

async function serverStatusCommand() {
  // Container status
  const psResult = await run('docker', [
    'ps',
    '-a',
    '--filter',
    `name=${containerName}`,
    '--format',
    'Name: {{.Names}}\nStatus: {{.Status}}\nPorts: {{.Ports}}',
  ])

  if (psResult.stdout) {
    console.log('=== Container ===')
    console.log(psResult.stdout)
  } else {
    console.log('=== Container ===')
    console.log('Not found')
  }

  // Health check
  console.log('')
  console.log('=== Health ===')
  const h = await getJson(`${apiBaseUrl}/health`)
  if (h.status === 200 && h.body?.ok) {
    console.log(`Server: healthy`)
    console.log(`Dashboard: ${baseOrigin}`)
  } else if (h.status === 0) {
    console.log('Server: not responding')
  } else {
    console.log(`Server: error (${JSON.stringify(h.body)})`)
  }
  process.exit(h.status === 200 ? 0 : 1)
}

// -- Helpers ------------------------------------------------------

function parseArgs(args) {
  const parsed = { commands: [], baseUrl: null, projectSlug: null }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--base-url' && args[i + 1]) {
      parsed.baseUrl = args[i + 1]
      i++
    } else if (args[i] === '--project-slug' && args[i + 1]) {
      parsed.projectSlug = args[i + 1]
      i++
    } else if (!args[i].startsWith('-')) {
      parsed.commands.push(args[i])
    }
  }
  return parsed
}

/* Run shell commands */
function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 30000 }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        code: err?.code ?? 0,
        stdout: stdout?.trim() || '',
        stderr: stderr?.trim() || '',
      })
    })
  })
}

// -- Main ---------------------------------------------------------

switch (command) {
  case 'hook':
    hookCommand()
    break
  case 'health':
    healthCommand()
    break
  case 'server':
    switch (subCommand) {
      case 'start':
        serverStartCommand()
        break
      case 'stop':
        serverStopCommand()
        break
      case 'status':
        serverStatusCommand()
        break
      default:
        console.error(`Unknown server command: ${subCommand}`)
        console.error('Usage: node observe_cli.mjs server <start|stop|status>')
        process.exit(1)
    }
    break
  default:
    console.error(`Unknown command: ${command}`)
    console.error(
      'Usage: node observe_cli.mjs <hook|health|server start|server stop|server status> [--base-url URL] [--project-slug SLUG]',
    )
    process.exit(1)
}
