#!/usr/bin/env node
// hooks/scripts/observe_cli.mjs
// CLI entrypoint for Agents Observe plugin.
// Commands: hook, health

import { getConfig } from './lib/config.mjs'
import { getJson, postJson } from './lib/http.mjs'
import { createLogger } from './lib/logger.mjs'
import { handleCallbackRequests } from './lib/callbacks.mjs'

const cliArgs = parseArgs(process.argv.slice(2))
const config = getConfig(cliArgs)
const log = createLogger('cli.log', config)

switch (cliArgs.commands[0] || 'hook') {
  case 'hook':
    hookCommand()
    break
  case 'health':
    healthCommand()
    break
  default:
    console.error(`Unknown command: ${cliArgs.commands[0]}`)
    console.error(
      'Usage: node observe_cli.mjs <hook|health> [--base-url URL] [--project-slug SLUG]',
    )
    process.exit(1)
}

// -- Commands -----------------------------------------------------

function hookCommand() {
  log.trace('CLI hook command invoked')

  let input = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    input += chunk
  })
  process.stdin.on('end', () => {
    if (!input.trim()) {
      log.trace('Empty stdin, skipping')
      return
    }

    let hookPayload
    try {
      hookPayload = JSON.parse(input)
    } catch (err) {
      log.warn(`Failed to parse hook payload: ${err.message}`)
      return
    }

    const hookEvent = hookPayload.event || 'unknown'
    const toolName = hookPayload.tool_name || hookPayload.tool?.name || ''
    log.debug(`Hook event: ${hookEvent}${toolName ? ` tool=${toolName}` : ''}`)
    log.trace(`Hook payload: ${input.trim().slice(0, 500)}`)

    const envelope = { hook_payload: hookPayload, meta: { env: {} } }
    if (config.projectSlug) {
      envelope.meta.env.AGENTS_OBSERVE_PROJECT_SLUG = config.projectSlug
    }

    // Send hook payload to API server
    postJson(`${config.apiBaseUrl}/events`, envelope, {
      fireAndForget: config.allowedCallbacks.size === 0,
      log,
    })
      .then((result) => {
        if (result.status === 0) {
          log.error(`Server unreachable at ${config.baseOrigin}: ${result.error}`)
          return
        }
        log.trace(`Server response: status=${result.status} hasRequests=${!!result.body?.requests}`)
        if (result.body?.requests) {
          // Handle callback requests from the server
          // Used to patch sessions info
          handleCallbackRequests(result.body.requests, { config, log })
        }
      })
      .catch((err) => {
        log.error(`Hook POST failed: ${err.message}`)
      })
  })
}

/**
 * Get health and runtime info about the server
 *
 * Used by observe-status skill
 */
async function healthCommand() {
  log.trace('CLI health command invoked')
  const healthUrl = `${config.apiBaseUrl}/health`
  const result = await getJson(healthUrl, { log })
  if (result.status === 200 && result.body?.ok) {
    const b = result.body
    const isDocker = b.runtime === 'docker'
    const runtime = isDocker ? `Docker` : 'local server'

    console.log(`Raw ${healthUrl} response:`)
    console.log(JSON.stringify(b, null, 2))
    console.log('')
    console.log('Hooks CLI (local):')
    console.log(`  CLI Path: ${config.cliPath}`)
    console.log(`  Log Level: ${config.logLevel || 'unknown'}`)
    console.log(`  Logs: ${config.logsDir}`)
    console.log(
      `  Allowed Callbacks: ${config.allowedCallbacks.size ? [...config.allowedCallbacks].join(', ') : 'none'}`,
    )
    console.log('')
    console.log(`Agents Observe Server (${runtime}):`)
    console.log(`  Version: v${b.version || 'unknown'}`)
    console.log(`  Dashboard: ${config.baseOrigin}`)
    console.log(`  API: ${config.apiBaseUrl}`)
    console.log(`  Runtime: ${runtime}`)
    if (isDocker) {
      console.log(`  Container Name: ${config.containerName}`)
      console.log(`  Image: ${config.dockerImage}`)
      console.log(`  Data Dir: ${config.dataDir} (bind mounted)`)
    } else {
      console.log(`  Database: ${b.dbPath || 'unknown'}`)
    }
    console.log(`  Log Level: ${b.logLevel || 'unknown'}`)
    process.exit(0)
  } else if (result.status === 0) {
    console.log(`Agents Observe server is not running.`)
    console.log(`  Checked: ${healthUrl}`)
    console.log(`  Error: ${result.error || 'connection refused'}`)
    process.exit(1)
  } else {
    console.log(`Agents Observe server error (HTTP ${result.status}):`)
    console.log(JSON.stringify(result.body, null, 2))
    process.exit(1)
  }
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
