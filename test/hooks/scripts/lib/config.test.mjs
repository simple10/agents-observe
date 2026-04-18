// test/config.test.mjs
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

// Snapshot and restore all env vars we touch
const envKeys = [
  'CLAUDE_PLUGIN_DATA',
  'AGENTS_OBSERVE_SERVER_PORT',
  'AGENTS_OBSERVE_API_BASE_URL',
  'AGENTS_OBSERVE_PROJECT_SLUG',
  'AGENTS_OBSERVE_DOCKER_CONTAINER_NAME',
  'AGENTS_OBSERVE_DOCKER_IMAGE',
  'AGENTS_OBSERVE_DATA_DIR',
  'AGENTS_OBSERVE_LOGS_DIR',
  'AGENTS_OBSERVE_LOG_LEVEL',
  'AGENTS_OBSERVE_TEST_SKIP_PULL',
  'AGENTS_OBSERVE_LOCAL_DATA_ROOT',
  'AGENTS_OBSERVE_RUNTIME',
  'AGENTS_OBSERVE_DEV_CLIENT_PORT',
  'AGENTS_OBSERVE_ALLOW_LOCAL_CALLBACKS',
  'AGENTS_OBSERVE_HOOK_STARTUP_TIMEOUT',
]

let savedEnv

beforeEach(() => {
  savedEnv = {}
  for (const k of envKeys) {
    savedEnv[k] = process.env[k]
    delete process.env[k]
  }
})

afterEach(() => {
  for (const k of envKeys) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
})

// Dynamic import to pick up env changes (module is stateless via getConfig())
async function loadConfig(overrides) {
  const mod = await import('../../../../hooks/scripts/lib/config.mjs')
  return mod.getConfig(overrides)
}

async function loadModule() {
  return await import('../../../../hooks/scripts/lib/config.mjs')
}

describe('config', () => {
  // --- Core defaults ---

  it('defaults serverPort to 4981', async () => {
    const cfg = await loadConfig()
    expect(cfg.serverPort).toBe('4981')
  })

  it('uses AGENTS_OBSERVE_SERVER_PORT env var', async () => {
    process.env.AGENTS_OBSERVE_SERVER_PORT = '9999'
    const cfg = await loadConfig()
    expect(cfg.serverPort).toBe('9999')
  })

  it('accepts serverPort via overrides', async () => {
    const cfg = await loadConfig({ serverPort: '8888' })
    expect(cfg.serverPort).toBe('8888')
  })

  it('defaults containerName to agents-observe', async () => {
    const cfg = await loadConfig()
    expect(cfg.containerName).toBe('agents-observe')
  })

  it('reads AGENTS_OBSERVE_DOCKER_CONTAINER_NAME', async () => {
    process.env.AGENTS_OBSERVE_DOCKER_CONTAINER_NAME = 'custom-container'
    const cfg = await loadConfig()
    expect(cfg.containerName).toBe('custom-container')
  })

  it('accepts containerName via overrides', async () => {
    const cfg = await loadConfig({ containerName: 'override-container' })
    expect(cfg.containerName).toBe('override-container')
  })

  it('defaults API_ID to agents-observe', async () => {
    const cfg = await loadConfig()
    expect(cfg.API_ID).toBe('agents-observe')
  })

  it('defaults pluginName to agents-observe', async () => {
    const cfg = await loadConfig()
    expect(cfg.pluginName).toBe('agents-observe')
  })

  it('exposes installDir as an absolute path', async () => {
    const cfg = await loadConfig()
    expect(cfg.installDir.startsWith('/')).toBe(true)
  })

  // --- Runtime ---

  it('defaults runtime to docker', async () => {
    const cfg = await loadConfig()
    expect(cfg.runtime).toBe('docker')
  })

  it('reads AGENTS_OBSERVE_RUNTIME env var', async () => {
    process.env.AGENTS_OBSERVE_RUNTIME = 'local'
    const cfg = await loadConfig()
    expect(cfg.runtime).toBe('local')
  })

  it('accepts runtime via overrides', async () => {
    const cfg = await loadConfig({ runtime: 'dev' })
    expect(cfg.runtime).toBe('dev')
  })

  // --- isPlugin ---

  it('sets isPlugin false when CLAUDE_PLUGIN_DATA is unset', async () => {
    const cfg = await loadConfig()
    expect(cfg.isPlugin).toBe(false)
  })

  it('sets isPlugin true when CLAUDE_PLUGIN_DATA is set', async () => {
    process.env.CLAUDE_PLUGIN_DATA = '/some/plugin/data/agents-observe'
    const cfg = await loadConfig()
    expect(cfg.isPlugin).toBe(true)
  })

  // --- Data directories ---

  it('derives dataDir from localDataRootDir when AGENTS_OBSERVE_DATA_DIR is unset', async () => {
    const cfg = await loadConfig()
    expect(cfg.dataDir).toBe(`${cfg.localDataRootDir}/data`)
  })

  it('prefers AGENTS_OBSERVE_DATA_DIR over localDataRootDir', async () => {
    process.env.AGENTS_OBSERVE_DATA_DIR = '/custom/data'
    const cfg = await loadConfig()
    expect(cfg.dataDir).toBe('/custom/data')
  })

  it('uses AGENTS_OBSERVE_LOCAL_DATA_ROOT when set', async () => {
    process.env.AGENTS_OBSERVE_LOCAL_DATA_ROOT = '/custom/root'
    const cfg = await loadConfig()
    expect(cfg.localDataRootDir).toBe('/custom/root')
  })

  it('accepts localDataRootDir via overrides', async () => {
    const cfg = await loadConfig({ localDataRootDir: '/override/root' })
    expect(cfg.localDataRootDir).toBe('/override/root')
  })

  it('uses CLAUDE_PLUGIN_DATA for localDataRootDir when set correctly', async () => {
    process.env.CLAUDE_PLUGIN_DATA = '/plugin/dir/agents-observe'
    const cfg = await loadConfig()
    expect(cfg.localDataRootDir).toBe('/plugin/dir/agents-observe')
    expect(cfg.dataDir).toBe('/plugin/dir/agents-observe/data')
    expect(cfg.logsDir).toBe('/plugin/dir/agents-observe/logs')
    expect(cfg.serverPortFile).toBe('/plugin/dir/agents-observe/server-port')
  })

  it('falls back to $HOME/.agents-observe when CLAUDE_PLUGIN_DATA points to wrong plugin', async () => {
    process.env.CLAUDE_PLUGIN_DATA = '/plugin/some-other-plugin/data'
    const cfg = await loadConfig()
    expect(cfg.localDataRootDir).toBe(`${process.env.HOME}/.agents-observe`)
  })

  it('defaults localDataRootDir to ./data when not a plugin', async () => {
    const cfg = await loadConfig()
    expect(cfg.localDataRootDir).toBe(`${cfg.installDir}/data`)
  })

  // --- Logs ---

  it('derives logsDir from localDataRootDir', async () => {
    const cfg = await loadConfig()
    expect(cfg.logsDir).toBe(`${cfg.localDataRootDir}/logs`)
  })

  it('prefers AGENTS_OBSERVE_LOGS_DIR over localDataRootDir', async () => {
    process.env.AGENTS_OBSERVE_LOGS_DIR = '/custom/logs'
    const cfg = await loadConfig()
    expect(cfg.logsDir).toBe('/custom/logs')
  })

  // --- Log level ---

  it('defaults logLevel to warn', async () => {
    const cfg = await loadConfig()
    expect(cfg.logLevel).toBe('warn')
  })

  it('reads AGENTS_OBSERVE_LOG_LEVEL', async () => {
    process.env.AGENTS_OBSERVE_LOG_LEVEL = 'trace'
    const cfg = await loadConfig()
    expect(cfg.logLevel).toBe('trace')
  })

  it('lowercases logLevel', async () => {
    process.env.AGENTS_OBSERVE_LOG_LEVEL = 'DEBUG'
    const cfg = await loadConfig()
    expect(cfg.logLevel).toBe('debug')
  })

  it('accepts logLevel via overrides', async () => {
    const cfg = await loadConfig({ logLevel: 'trace' })
    expect(cfg.logLevel).toBe('trace')
  })

  // --- Client port ---

  it('defaults clientPort to serverPort when not dev mode', async () => {
    const cfg = await loadConfig()
    expect(cfg.clientPort).toBe(cfg.serverPort)
  })

  it('defaults clientPort to 5174 in dev mode', async () => {
    const cfg = await loadConfig({ runtime: 'dev' })
    expect(cfg.clientPort).toBe('5174')
  })

  it('reads AGENTS_OBSERVE_DEV_CLIENT_PORT', async () => {
    process.env.AGENTS_OBSERVE_DEV_CLIENT_PORT = '3000'
    const cfg = await loadConfig()
    expect(cfg.clientPort).toBe('3000')
  })

  // --- Docker image ---

  it('constructs dockerImage from version', async () => {
    const cfg = await loadConfig()
    if (cfg.expectedVersion) {
      expect(cfg.dockerImage).toBe(`ghcr.io/simple10/agents-observe:v${cfg.expectedVersion}`)
    } else {
      expect(cfg.dockerImage).toBe('ghcr.io/simple10/agents-observe:latest')
    }
  })

  it('prefers AGENTS_OBSERVE_DOCKER_IMAGE env var', async () => {
    process.env.AGENTS_OBSERVE_DOCKER_IMAGE = 'custom:image'
    const cfg = await loadConfig()
    expect(cfg.dockerImage).toBe('custom:image')
  })

  // --- Docker label ---

  it('exposes dockerLabel with simple10 prefix', async () => {
    const cfg = await loadConfig()
    expect(cfg.dockerLabel).toBe('simple10-agents-observe.managed')
  })

  // --- Test skip pull ---

  it('defaults testSkipPull to false', async () => {
    const cfg = await loadConfig()
    expect(cfg.testSkipPull).toBe(false)
  })

  it('sets testSkipPull true when AGENTS_OBSERVE_TEST_SKIP_PULL=1', async () => {
    process.env.AGENTS_OBSERVE_TEST_SKIP_PULL = '1'
    const cfg = await loadConfig()
    expect(cfg.testSkipPull).toBe(true)
  })

  it('accepts testSkipPull via overrides', async () => {
    const cfg = await loadConfig({ testSkipPull: true })
    expect(cfg.testSkipPull).toBe(true)
  })

  // --- API URL ---

  it('derives apiBaseUrl from serverPort', async () => {
    const cfg = await loadConfig()
    expect(cfg.apiBaseUrl).toBe(`http://127.0.0.1:${cfg.serverPort}/api`)
  })

  it('prefers AGENTS_OBSERVE_API_BASE_URL env var', async () => {
    process.env.AGENTS_OBSERVE_API_BASE_URL = 'http://custom:9999/api'
    const cfg = await loadConfig()
    expect(cfg.apiBaseUrl).toBe('http://custom:9999/api')
  })

  it('accepts baseUrl via overrides', async () => {
    const cfg = await loadConfig({ baseUrl: 'http://override:8888/api' })
    expect(cfg.apiBaseUrl).toBe('http://override:8888/api')
  })

  it('derives baseOrigin from apiBaseUrl', async () => {
    const cfg = await loadConfig()
    expect(cfg.baseOrigin).toBe(`http://127.0.0.1:${cfg.serverPort}`)
  })

  // --- hasCustomApiUrl ---

  it('sets hasCustomApiUrl false when using default', async () => {
    const cfg = await loadConfig()
    expect(cfg.hasCustomApiUrl).toBe(false)
  })

  it('sets hasCustomApiUrl true when AGENTS_OBSERVE_API_BASE_URL is set', async () => {
    process.env.AGENTS_OBSERVE_API_BASE_URL = 'http://remote:9999/api'
    const cfg = await loadConfig()
    expect(cfg.hasCustomApiUrl).toBe(true)
  })

  it('sets hasCustomApiUrl true when baseUrl override is provided', async () => {
    const cfg = await loadConfig({ baseUrl: 'http://override:8888/api' })
    expect(cfg.hasCustomApiUrl).toBe(true)
  })

  // --- hookStartupTimeout ---

  it('defaults hookStartupTimeout to 30000', async () => {
    const cfg = await loadConfig()
    expect(cfg.hookStartupTimeout).toBe(30000)
  })

  it('reads AGENTS_OBSERVE_HOOK_STARTUP_TIMEOUT', async () => {
    process.env.AGENTS_OBSERVE_HOOK_STARTUP_TIMEOUT = '10000'
    const cfg = await loadConfig()
    expect(cfg.hookStartupTimeout).toBe(10000)
  })

  it('parses hookStartupTimeout as integer', async () => {
    process.env.AGENTS_OBSERVE_HOOK_STARTUP_TIMEOUT = '5000'
    const cfg = await loadConfig()
    expect(cfg.hookStartupTimeout).toBe(5000)
    expect(Number.isInteger(cfg.hookStartupTimeout)).toBe(true)
  })

  // --- Callbacks ---

  it('defaults allowedCallbacks to all handlers', async () => {
    const cfg = await loadConfig()
    expect(cfg.allowedCallbacks.has('getSessionInfo')).toBe(true)
  })

  it('restricts allowedCallbacks from env var', async () => {
    process.env.AGENTS_OBSERVE_ALLOW_LOCAL_CALLBACKS = 'getSessionInfo'
    const cfg = await loadConfig()
    expect(cfg.allowedCallbacks.size).toBe(1)
    expect(cfg.allowedCallbacks.has('getSessionInfo')).toBe(true)
  })

  it('filters out unknown callback names', async () => {
    process.env.AGENTS_OBSERVE_ALLOW_LOCAL_CALLBACKS = 'getSessionInfo,nonexistent'
    const cfg = await loadConfig()
    expect(cfg.allowedCallbacks.size).toBe(1)
  })

  // --- Project slug ---

  it('defaults projectSlug to null', async () => {
    const cfg = await loadConfig()
    expect(cfg.projectSlug).toBeNull()
  })

  it('reads AGENTS_OBSERVE_PROJECT_SLUG', async () => {
    process.env.AGENTS_OBSERVE_PROJECT_SLUG = 'my-project'
    const cfg = await loadConfig()
    expect(cfg.projectSlug).toBe('my-project')
  })

  it('accepts projectSlug via overrides', async () => {
    const cfg = await loadConfig({ projectSlug: 'override-slug' })
    expect(cfg.projectSlug).toBe('override-slug')
  })
})

describe('getServerEnv', () => {
  it('uses container paths for docker runtime', async () => {
    const mod = await loadModule()
    const cfg = mod.getConfig({ runtime: 'docker' })
    const env = mod.getServerEnv(cfg)

    expect(env.AGENTS_OBSERVE_SERVER_PORT).toBe('4981')
    expect(env.AGENTS_OBSERVE_DB_PATH).toBe('/data/observe.db')
    expect(env.AGENTS_OBSERVE_CLIENT_DIST_PATH).toBe('/app/client/dist')
    expect(env.AGENTS_OBSERVE_RUNTIME).toBe('docker')
    expect(env.AGENTS_OBSERVE_STORAGE_ADAPTER).toBe('sqlite')
  })

  it('uses host paths for local runtime', async () => {
    const mod = await loadModule()
    const cfg = mod.getConfig({ runtime: 'local' })
    const env = mod.getServerEnv(cfg)

    expect(env.AGENTS_OBSERVE_SERVER_PORT).toBe(cfg.serverPort)
    expect(env.AGENTS_OBSERVE_DB_PATH).toContain(cfg.dataDir)
    expect(env.AGENTS_OBSERVE_DB_PATH).toContain('observe.db')
    expect(env.AGENTS_OBSERVE_CLIENT_DIST_PATH).toContain('app/client/dist')
    expect(env.AGENTS_OBSERVE_CLIENT_DIST_PATH).toContain(cfg.installDir)
    expect(env.AGENTS_OBSERVE_RUNTIME).toBe('local')
  })

  it('sets empty CLIENT_DIST_PATH and RUNTIME_DEV for dev runtime', async () => {
    const mod = await loadModule()
    const cfg = mod.getConfig({ runtime: 'dev' })
    const env = mod.getServerEnv(cfg)

    expect(env.AGENTS_OBSERVE_SERVER_PORT).toBe(cfg.serverPort)
    expect(env.AGENTS_OBSERVE_CLIENT_DIST_PATH).toBe('')
    expect(env.AGENTS_OBSERVE_RUNTIME).toBe('local')
    expect(env.AGENTS_OBSERVE_RUNTIME_DEV).toBe('1')
    expect(env.AGENTS_OBSERVE_SHUTDOWN_DELAY_MS).toBe(String(cfg.shutdownDelayMs))
  })

  it('always includes log level and storage adapter', async () => {
    const mod = await loadModule()
    for (const runtime of ['docker', 'local', 'dev']) {
      const cfg = mod.getConfig({ runtime })
      const env = mod.getServerEnv(cfg)
      expect(env.AGENTS_OBSERVE_LOG_LEVEL).toBe(cfg.logLevel)
      expect(env.AGENTS_OBSERVE_STORAGE_ADAPTER).toBe('sqlite')
    }
  })
})

describe('getClientEnv', () => {
  it('returns server port and client port', async () => {
    const mod = await loadModule()
    const cfg = mod.getConfig()
    const env = mod.getClientEnv(cfg)

    expect(env.AGENTS_OBSERVE_SERVER_PORT).toBe(cfg.serverPort)
    expect(env.AGENTS_OBSERVE_DEV_CLIENT_PORT).toBeDefined()
  })
})
