// hooks/scripts/lib/config.mjs
// Centralized config resolution for Agents Observe CLI and MCP server.
// No dependencies - uses only Node.js built-ins.

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ALL_CALLBACK_HANDLERS } from './callbacks.mjs'

// Absolute path to root of this project, where the plugin is installed
const installDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../')

function readMcpPort(mcpPortFile) {
  try {
    return readFileSync(mcpPortFile, 'utf8').trim() || null
  } catch {
    return null
  }
}

function readVersion() {
  // VERSION file is at repo root — 3 levels up from hooks/scripts/lib/
  // const dir = dirname(fileURLToPath(import.meta.url))
  const versionFile = resolve(installDir, './VERSION')
  try {
    return readFileSync(versionFile, 'utf8').trim()
  } catch {
    return null
  }
}

/**
 * Returns shared config. Accepts optional CLI overrides.
 */
export function getConfig(overrides = {}) {
  const pluginDataDir = process.env.CLAUDE_PLUGIN_DATA || `${process.env.HOME}/.agents-observe`
  const mcpPortFile = `${pluginDataDir}/mcp-port`
  const serverPort = process.env.AGENTS_OBSERVE_SERVER_PORT || '4981'
  const savedPort = readMcpPort(mcpPortFile)
  const apiBaseUrl =
    overrides.baseUrl ||
    process.env.AGENTS_OBSERVE_API_BASE_URL ||
    (savedPort ? `http://127.0.0.1:${savedPort}/api` : `http://127.0.0.1:${serverPort}/api`)
  const baseOrigin = new URL(apiBaseUrl).origin
  const version = readVersion()
  const dockerImage =
    process.env.AGENTS_OBSERVE_DOCKER_IMAGE ||
    `ghcr.io/simple10/agents-observe:${version ? `v${version}` : 'latest'}`

  const allowedCallbacksRaw = (process.env.AGENTS_OBSERVE_ALLOW_LOCAL_CALLBACKS ?? 'all').trim()
  const allowedCallbacks = new Set(
    allowedCallbacksRaw.toLowerCase() === 'all'
      ? ALL_CALLBACK_HANDLERS
      : allowedCallbacksRaw
          .split(',')
          .map((s) => s.trim())
          .filter((s) => ALL_CALLBACK_HANDLERS.includes(s)),
  )

  return {
    serverPort,
    apiBaseUrl,
    baseOrigin,
    pluginDataDir,

    cliPath: resolve(installDir, './hooks/scripts/observe_cli.mjs'),
    logLevel: (process.env.AGENTS_OBSERVE_LOG_LEVEL || '').toLowerCase(),
    logsDir: resolve(installDir, process.env.AGENTS_OBSERVE_LOGS_DIR || `${pluginDataDir}/logs`),

    /* Allowed server callbacks array */
    allowedCallbacks,

    projectSlug: overrides.projectSlug || process.env.AGENTS_OBSERVE_PROJECT_SLUG || null,
    containerName: process.env.AGENTS_OBSERVE_DOCKER_CONTAINER_NAME || 'agents-observe',
    dockerImage,
    dataDir: resolve(installDir, process.env.AGENTS_OBSERVE_DATA_DIR || `${pluginDataDir}/data`),
    API_ID: 'agents-observe',
    expectedVersion: version,

    /* Persist mcp server when claude code session ends */
    mcpPersist: (process.env.AGENTS_OBSERVE_SERVER_PERSIST || 'true').toLowerCase() !== 'false',
    mcpPortFile,
  }
}
