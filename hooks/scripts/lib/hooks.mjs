// hooks/scripts/lib/hooks.mjs
// Hook command implementations for the Agents Observe CLI.
// Separated from observe_cli.mjs to keep the CLI entrypoint thin.

import { postJson, getJson } from './http.mjs'
import { handleCallbackRequests } from './callbacks.mjs'
import { startServer } from './docker.mjs'
import { getAgentClass, getAgentLib } from './agents/index.mjs'

// -- Helpers ----------------------------------------------------------

/**
 * Redact oversized base64 image blobs from a tool_response payload
 * before it gets posted to the server. Targets Claude-Code tool
 * response shape where tool_response is an array of content items
 * like `{ type: 'image', source: { type: 'base64', media_type, data } }`.
 * Mutates in place — the hook payload is consumed once and not read
 * again after dispatch.
 *
 * `maxChars <= 0` disables redaction entirely.
 */
function stripLargeImageData(hookPayload, maxChars) {
  if (!maxChars || maxChars <= 0) return
  const resp = hookPayload?.tool_response
  if (!Array.isArray(resp)) return
  for (const item of resp) {
    if (!item || typeof item !== 'object') continue
    if (item.type !== 'image') continue
    const src = item.source
    if (!src || typeof src !== 'object') continue
    if (src.type !== 'base64') continue
    if (typeof src.data !== 'string') continue
    if (src.data.length > maxChars) {
      src.data = '[REDACTED]'
    }
  }
}

/**
 * Dispatch to the agent-class-specific `buildHookEvent` to produce the
 * POST envelope. Returns { envelope, hookEvent, toolName } — the latter
 * two are used only for local logging.
 */
function dispatchHookEvent(config, log, hookPayload) {
  // Strip large base64 images from the payload before the agent lib
  // wraps it in an envelope. Otherwise MCP devtools screenshot tools
  // can push multi-MB events into the DB.
  stripLargeImageData(hookPayload, config?.maxImageDataChars)
  const agentClass = getAgentClass(config, log, hookPayload)
  const lib = getAgentLib(agentClass)
  return lib.buildHookEvent(config, log, hookPayload)
}

// Exported for tests only — redaction is applied internally by
// dispatchHookEvent in the normal hook flow.
export const __testing = { stripLargeImageData }

/**
 * Mute console.log/error/warn so only our final JSON goes to stdout.
 * Logger file writes still work — only the console output methods are silenced.
 */
function muteConsole() {
  const noop = () => {}
  console.log = noop
  console.error = noop
  console.warn = noop
  console.debug = noop
}

/**
 * Output a systemMessage JSON to stdout for Claude to surface to the user.
 * This must be the ONLY stdout output — console is muted before this runs.
 */
function outputClaudeSystemMessage(message) {
  process.stdout.write(JSON.stringify({ systemMessage: message }) + '\n')
}

/**
 * Read all stdin into a string (returns promise).
 */
function readStdin() {
  return new Promise((resolve) => {
    let input = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => {
      input += chunk
    })
    process.stdin.on('end', () => resolve(input.trim() || null))
  })
}

/**
 * Parse stdin JSON, build envelope, POST to server synchronously.
 * Returns { result, envelope } — does NOT use fireAndForget.
 */
async function sendHookSync(config, log) {
  const input = await readStdin()
  if (!input) return { result: null, envelope: null }

  let hookPayload
  try {
    hookPayload = JSON.parse(input)
  } catch (err) {
    log.warn(`Failed to parse hook payload: ${err.message}`)
    return { result: null, envelope: null }
  }

  const { envelope, hookEvent, toolName } = dispatchHookEvent(config, log, hookPayload)
  log.debug(`Hook event: ${hookEvent}${toolName ? ` tool=${toolName}` : ''}`)

  const result = await postJson(`${config.apiBaseUrl}/events`, envelope, { log })
  return { result, envelope }
}

/**
 * Handle a successful server response: process callbacks and return systemMessage.
 */
function handleSuccessResponse(result, config, log) {
  if (result.body?.requests) {
    handleCallbackRequests(result.body.requests, { config, log })
  }
  const serverMessage = result.body?.systemMessage
  if (serverMessage) {
    outputClaudeSystemMessage(serverMessage)
  } else {
    outputClaudeSystemMessage(`Agents Observe: logging events. Dashboard: ${config.baseOrigin}`)
  }
}

// -- Commands ---------------------------------------------------------

/**
 * hook: Fire-and-forget event POST. Reads stdin, POSTs to server, exits.
 */
export function hookCommand(config, log) {
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

    const { envelope, hookEvent, toolName } = dispatchHookEvent(config, log, hookPayload)
    log.debug(`Hook event: ${hookEvent}${toolName ? ` tool=${toolName}` : ''}`)
    log.trace(`Hook payload: ${input.trim().slice(0, 500)}`)

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
          return handleCallbackRequests(result.body.requests, { config, log })
        }
      })
      .catch((err) => {
        log.error(`Hook POST failed: ${err.message}`)
      })
  })
}

/**
 * hook-sync: Synchronous event POST that returns systemMessage JSON to Claude.
 * Mutes all console output so only the JSON goes to stdout.
 */
export async function hookSyncCommand(config, log) {
  muteConsole()

  try {
    const { result } = await sendHookSync(config, log)

    if (!result || result.status === 0) {
      outputClaudeSystemMessage(
        `Agents Observe server is not running. Run /observe status for help.`,
      )
      return
    }

    handleSuccessResponse(result, config, log)
  } catch (err) {
    log.error(`hook-sync failed: ${err.message}`)
    outputClaudeSystemMessage(`Agents Observe: internal error. Run /observe status for help.`)
  }
}

/**
 * hook-autostart: Like hook-sync, but auto-starts the server if unreachable.
 * Waits up to hookStartupTimeout ms for the server to become healthy.
 */
export async function hookAutostartCommand(config, log) {
  muteConsole()

  try {
    const { result, envelope } = await sendHookSync(config, log)

    // Server is reachable — handle normally
    if (result && result.status !== 0) {
      handleSuccessResponse(result, config, log)
      return
    }

    // Server unreachable — auto-start (only if using a local server)
    if (config.hasCustomApiUrl) {
      log.warn('Server unreachable at custom API URL — skipping auto-start')
      outputClaudeSystemMessage(
        `Agents Observe: server unreachable at ${config.apiBaseUrl}. Run /observe status for help.`,
      )
      return
    }

    log.warn('Server not running, auto-starting...')

    // Start the server in the background — don't await it directly because
    // docker pull + health loop can exceed the timeout. Instead, poll for
    // health independently so we detect the server as soon as it's up.
    let startFinished = false
    const startPromise = startServer(config, log).then((port) => {
      startFinished = true
      return port
    })

    // Poll for health until the server is up or we hit the timeout
    const deadline = Date.now() + config.hookStartupTimeout
    let actualPort = null
    while (Date.now() < deadline) {
      const h = await getJson(`${config.apiBaseUrl}/health`, { log: null })
      if (h.status === 200 && h.body?.ok) {
        actualPort = config.serverPort
        break
      }
      if (startFinished) {
        actualPort = await startPromise
        break
      }
      await new Promise((r) => setTimeout(r, 1000))
    }

    if (!actualPort) {
      outputClaudeSystemMessage(
        `Agents Observe: server is starting (timed out after ${
          config.hookStartupTimeout / 1000
        }s). Run /observe status to check.`,
      )
      return
    }

    log.info(`Server auto-started on port ${actualPort}`)

    // Retry sending the original event if we have one
    if (envelope) {
      const retryUrl = `http://127.0.0.1:${actualPort}/api/events`
      const retry = await postJson(retryUrl, envelope, { log })
      if (retry.status !== 0) {
        log.info('Event delivered after auto-start')
        if (retry.body?.requests) {
          await handleCallbackRequests(retry.body.requests, { config, log })
        }
      } else {
        log.error(`Event delivery failed after auto-start: ${retry.error}`)
      }
    }

    const dashboardUrl = `http://127.0.0.1:${actualPort}`
    outputClaudeSystemMessage(`Agents Observe: server started. Dashboard: ${dashboardUrl}`)
  } catch (err) {
    log.error(`hook-autostart failed: ${err.message}`)
    outputClaudeSystemMessage(`Agents Observe: internal error. Run /observe status for help.`)
  }
}
