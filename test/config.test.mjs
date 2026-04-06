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
  const mod = await import('../hooks/scripts/lib/config.mjs')
  return mod.getConfig(overrides)
}

describe('config', () => {
  it('uses AGENTS_OBSERVE namespace for env vars', async () => {
    process.env.AGENTS_OBSERVE_SERVER_PORT = '9999'
    const cfg = await loadConfig()
    expect(cfg.serverPort).toBe('9999')
  })

  it('defaults containerName to agents-observe', async () => {
    const cfg = await loadConfig()
    expect(cfg.containerName).toBe('agents-observe')
  })

  it('defaults API_ID to agents-observe', async () => {
    const cfg = await loadConfig()
    expect(cfg.API_ID).toBe('agents-observe')
  })

  it('derives dataDir from pluginDataDir when AGENTS_OBSERVE_DATA_DIR is unset', async () => {
    const cfg = await loadConfig()
    expect(cfg.dataDir).toBe(`${cfg.pluginDataDir}/data`)
  })

  it('prefers AGENTS_OBSERVE_DATA_DIR over pluginDataDir', async () => {
    process.env.AGENTS_OBSERVE_DATA_DIR = '/custom/data'
    const cfg = await loadConfig()
    expect(cfg.dataDir).toBe('/custom/data')
  })

  it('uses CLAUDE_PLUGIN_DATA for pluginDataDir when set', async () => {
    process.env.CLAUDE_PLUGIN_DATA = '/plugin/dir'
    const cfg = await loadConfig()
    expect(cfg.pluginDataDir).toBe('/plugin/dir')
    expect(cfg.dataDir).toBe('/plugin/dir/data')
  })

  it('falls back to $HOME/.agents-observe for pluginDataDir', async () => {
    const cfg = await loadConfig()
    expect(cfg.pluginDataDir).toBe(`${process.env.HOME}/.agents-observe`)
  })

  it('derives logsDir from pluginDataDir', async () => {
    const cfg = await loadConfig()
    expect(cfg.logsDir).toBe(`${cfg.pluginDataDir}/logs`)
  })

  it('prefers AGENTS_OBSERVE_LOGS_DIR over pluginDataDir', async () => {
    process.env.AGENTS_OBSERVE_LOGS_DIR = '/custom/logs'
    const cfg = await loadConfig()
    expect(cfg.logsDir).toBe('/custom/logs')
  })

  it('exposes logLevel from AGENTS_OBSERVE_LOG_LEVEL', async () => {
    process.env.AGENTS_OBSERVE_LOG_LEVEL = 'trace'
    const cfg = await loadConfig()
    expect(cfg.logLevel).toBe('trace')
  })

  it('defaults logLevel to warn', async () => {
    const cfg = await loadConfig()
    expect(cfg.logLevel).toBe('warn')
  })

  it('defaults testSkipPull to false', async () => {
    const cfg = await loadConfig()
    expect(cfg.testSkipPull).toBe(false)
  })

  it('sets testSkipPull true when AGENTS_OBSERVE_TEST_SKIP_PULL=1', async () => {
    process.env.AGENTS_OBSERVE_TEST_SKIP_PULL = '1'
    const cfg = await loadConfig()
    expect(cfg.testSkipPull).toBe(true)
  })
})
