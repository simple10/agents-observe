import { postJson } from './http.mjs'
import * as claudeCode from './agents/claude-code.mjs'
import * as codex from './agents/codex.mjs'

/** Agent-specific callback modules keyed by agentClass. */
const AGENT_LIBS = {
  'claude-code': claudeCode,
  codex: codex,
}

/* Array of all available callbacks */
export const ALL_CALLBACK_HANDLERS = ['getSessionInfo']

/* Callbacks are functions invoked by the server via requests in API server response */
const callbackHandlers = {
  /**
   * Ask the agent-specific lib to extract session metadata (slug +
   * git info) from the transcript jsonl. The server picks an agentClass
   * and passes it in `args`; we dispatch to the matching module and
   * post the result back to the callback URL.
   *
   * Contract: each agent's getSessionInfo returns
   *   { slug: string|null, git: { branch: string|null, repository_url: string|null } }
   * or null when it can't read the transcript at all.
   */
  getSessionInfo(args, ctx) {
    const agentClass = args.agentClass
    const agent = agentClass ? AGENT_LIBS[agentClass] : null
    if (!agent || typeof agent.getSessionInfo !== 'function') {
      ctx.log.debug(
        `getSessionInfo: no agent handler for agentClass="${agentClass ?? ''}"; skipping`,
      )
      return null
    }
    return agent.getSessionInfo(args, ctx)
  },
}

/**
 * Handle callback requests from server
 *
 * @param {Array} requests
 * @param {Opts} param1
 * @returns
 */
export async function handleCallbackRequests(requests, { config, log }) {
  if (!Array.isArray(requests)) {
    log.warn(`Invalid requests type '${typeof requests}', requests must be an array`)
    return
  }
  log.debug(`Processing ${requests.length} callback request(s)`)

  const allowedCallbacks = config.allowedCallbacks

  for (const req of requests) {
    log.trace(
      `Callback request: cmd=${req.cmd} callback=${req.callback || 'none'} args=${JSON.stringify(
        req.args || {},
      )}`,
    )

    if (allowedCallbacks && !allowedCallbacks.has(req.cmd)) {
      log.warn(`Blocked callback: ${req.cmd} (not in AGENTS_OBSERVE_ALLOW_LOCAL_CALLBACKS)`)
      continue
    }

    const handler = callbackHandlers[req.cmd]

    if (!handler) {
      log.warn(`No handler for callback: ${req.cmd}`)
      continue
    }

    const result = handler(req.args || {}, { config, log })

    log.debug(`Callback ${req.cmd} result: ${JSON.stringify(result)}`)

    if (result && req.callback) {
      // Mirror the request's agentClass + cwd into the response so the
      // server doesn't need to re-look them up — this keeps the request
      // and its response tightly coupled (the server processes exactly
      // what this invocation reported, not whatever the db says now).
      const payload = {
        ...result,
        agentClass: req.args?.agentClass ?? null,
        cwd: req.args?.cwd ?? null,
      }
      const callbackUrl = `${config.baseOrigin}${req.callback}`
      log.debug(`Posting callback response to ${callbackUrl}`)

      const resp = await postJson(callbackUrl, payload)
      log.trace(`Callback response status: ${resp.status}`)
    }
  }
}
