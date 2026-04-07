// hooks/scripts/lib/config.mjs
// Centralized config resolution for Agents Observe CLI and MCP server.
// No dependencies - uses only Node.js built-ins.

import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ALL_CALLBACK_HANDLERS } from './callbacks.mjs'
import {
  resolvePluginDataDir,
  readServerPortFile,
  readVersionFile,
  ensureLocalDataDirs,
} from './fs.mjs'

// Absolute path to root of this project, where the plugin is installed
const installDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../')

/**
 * Returns shared config. Accepts optional CLI overrides.
 */
export function getConfig(overrides = {}) {
  /** Name of plugin to use for validating CLAUDE_PLUGIN_* env vars at runtime */
  const pluginName = 'agents-observe'
  /** True when claude is running the scripts as via plugin hooks or mcp */
  const isPlugin = !!process.env.CLAUDE_PLUGIN_DATA

  /** Runtime used by start scripts: docker | local | dev */
  const runtime = overrides.runtime || process.env.AGENTS_OBSERVE_RUNTIME || 'docker'

  const homeDir = process.env.HOME || ''
  const pluginDataDir = process.env.CLAUDE_PLUGIN_DATA

  const serverPortFileName = 'server-port'

  // Mini config to pass to resolvePluginDataDir and readVersionFile
  const tmpConfig = {
    installDir,
    pluginName,
    pluginDataDir,
    homeDir,
    serverPortFileName,
  }

  // Set data root dir - defaults to ./data
  const localDataRootDir =
    overrides.localDataRootDir ||
    process.env.AGENTS_OBSERVE_LOCAL_DATA_ROOT ||
    (isPlugin && (resolvePluginDataDir(tmpConfig) || resolve(homeDir, `.${pluginName}`))) ||
    resolve(installDir, './data')

  const dataDir = resolve(
    installDir,
    overrides.dataDir || process.env.AGENTS_OBSERVE_DATA_DIR || `${localDataRootDir}/data`,
  )

  const serverPortFile = `${localDataRootDir}/${serverPortFileName}`
  const serverPort = overrides.serverPort || process.env.AGENTS_OBSERVE_SERVER_PORT || '4981'
  const savedPort = readServerPortFile(serverPortFile)
  const apiBaseUrl =
    overrides.baseUrl ||
    process.env.AGENTS_OBSERVE_API_BASE_URL ||
    (savedPort ? `http://127.0.0.1:${savedPort}/api` : `http://127.0.0.1:${serverPort}/api`)
  const baseOrigin = new URL(apiBaseUrl).origin
  const version = readVersionFile(tmpConfig)
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
    pluginName,
    isPlugin,
    pluginDataDir, // Only set when running as a plugin
    installDir,
    homeDir,

    runtime,

    serverPort,
    serverPortFile,
    serverPortFileName,
    apiBaseUrl,
    baseOrigin,
    localDataRootDir,

    clientPort:
      process.env.AGENTS_OBSERVE_DEV_CLIENT_PORT || (runtime === 'dev' ? '5174' : serverPort),

    cliPath: resolve(installDir, './hooks/scripts/observe_cli.mjs'),
    logLevel: (overrides.logLevel || process.env.AGENTS_OBSERVE_LOG_LEVEL || 'warn').toLowerCase(),
    logsDir: resolve(installDir, process.env.AGENTS_OBSERVE_LOGS_DIR || `${localDataRootDir}/logs`),

    /** Allowed server callbacks array */
    allowedCallbacks,

    projectSlug: overrides.projectSlug || process.env.AGENTS_OBSERVE_PROJECT_SLUG || null,
    containerName:
      overrides.containerName ||
      process.env.AGENTS_OBSERVE_DOCKER_CONTAINER_NAME ||
      'agents-observe',
    dockerImage,

    /* Local dir used to store sqlite database */
    dataDir,
    databaseFileName: 'observe.db',

    API_ID: 'agents-observe',
    expectedVersion: version,

    /* Test harness only — skip `docker pull` when image is pre-loaded. See docs/plans/_queued/spec-fresh-install-test-harness.md */
    testSkipPull: overrides.testSkipPull || process.env.AGENTS_OBSERVE_TEST_SKIP_PULL === '1',

    serverPortFile,

    installDir,
  }
}

/**
 * Returns env vars for the server process, matching what docker-compose
 * and docker.mjs pass to the container. Use with spawn/exec env overrides.
 */
export function getServerEnv(config) {
  // TODO: add config.runtime check and set client dist path correctly
  return {
    AGENTS_OBSERVE_SERVER_PORT: config.serverPort,
    AGENTS_OBSERVE_DB_PATH: resolve(config.dataDir, config.databaseFileName),
    AGENTS_OBSERVE_CLIENT_DIST_PATH: resolve(config.installDir, 'app/client/dist'),
    AGENTS_OBSERVE_LOG_LEVEL: config.logLevel,
    AGENTS_OBSERVE_RUNTIME: config.runtime,
    AGENTS_OBSERVE_STORAGE_ADAPTER: 'sqlite', // Only adapter currently supported
  }
}

/**
 * Returns env vars for the client dev server / build. Used by vite.config.ts
 * for the dev proxy target and dev server port.
 */
export function getClientEnv(config) {
  return {
    AGENTS_OBSERVE_SERVER_PORT: config.serverPort,
    AGENTS_OBSERVE_DEV_CLIENT_PORT: process.env.AGENTS_OBSERVE_DEV_CLIENT_PORT || '5174',
  }
}

/**
 * Ensure local data dirs are created
 *
 * This function should be called before starting the server via mcp or local start scripts
 * @param {*} config
 * @returns
 */
export function initLocalDataDirs(config) {
  return ensureLocalDataDirs(config)
}
