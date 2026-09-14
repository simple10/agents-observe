// test/hooks/scripts/supervision/lib/observe-env.test.mjs
import { describe, it, expect, afterEach } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { runShell, makeDataRoot, removeDataRoot } from '../helpers.mjs'

const roots = []

function dataRoot() {
  const root = makeDataRoot('observe-env')
  roots.push(root)
  return root
}

afterEach(() => {
  while (roots.length) removeDataRoot(roots.pop())
})

const env = (script, opts = {}) => runShell(script, { lib: 'observe-env.sh', ...opts })

describe('observe_env_init path resolution', () => {
  it('derives every runtime path from the data root', async () => {
    const root = dataRoot()
    const { stdout, code } = await env(
      'printf "%s\\n%s\\n%s\\n%s\\n%s\\n" "$OBSERVE_RUNTIME" "$OBSERVE_LOCK" "$OBSERVE_START_LOCK" "$OBSERVE_HEARTBEAT" "$OBSERVE_LIFECYCLE_LOG"',
      { dataRoot: root },
    )
    expect(code).toBe(0)
    expect(stdout.trim().split('\n')).toEqual([
      `${root}/runtime`,
      `${root}/runtime/collector.lock`,
      `${root}/runtime/collector-start.lock`,
      `${root}/runtime/collector.heartbeat`,
      `${root}/runtime/collector-lifecycle.log`,
    ])
  })

  it('prefers an explicit argument over the environment', async () => {
    const root = dataRoot()
    const other = dataRoot()
    const { stdout } = await env(
      `observe_env_init '${other}'; printf '%s\\n' "$OBSERVE_DATA_ROOT"`,
      { dataRoot: root },
    )
    expect(stdout.trim()).toBe(other)
  })

  it('falls back to AGENTS_OBSERVE_LOCAL_DATA_ROOT, the existing data dir override', async () => {
    const root = dataRoot()
    const { stdout } = await env('observe_env_init && printf "%s\\n" "$OBSERVE_DATA_ROOT"', {
      env: { AGENTS_OBSERVE_DATA_ROOT: '', AGENTS_OBSERVE_LOCAL_DATA_ROOT: root },
    })
    expect(stdout.trim()).toBe(root)
  })

  it('falls back to ~/.agents-observe when nothing is configured', async () => {
    const home = dataRoot()
    const { stdout } = await env('observe_env_init && printf "%s\\n" "$OBSERVE_DATA_ROOT"', {
      env: {
        AGENTS_OBSERVE_DATA_ROOT: '',
        AGENTS_OBSERVE_LOCAL_DATA_ROOT: '',
        HOME: home,
      },
    })
    expect(stdout.trim()).toBe(`${home}/.agents-observe`)
  })

  it('strips a trailing slash instead of doubling it', async () => {
    const root = dataRoot()
    const { stdout } = await env(
      `observe_env_init '${root}/' && printf '%s\\n' "$OBSERVE_LOCK"`,
      {},
    )
    expect(stdout.trim()).toBe(`${root}/runtime/collector.lock`)
  })
})

describe('observe_env_init rejects unsafe data roots', () => {
  const unsafe = [
    ['empty with no HOME', ''],
    ['the filesystem root', '/'],
    ['a relative path', 'relative/path'],
    ['a parent traversal', '/tmp/a/../b'],
  ]

  for (const [label, value] of unsafe) {
    it(`rejects ${label}`, async () => {
      const { code, stderr } = await env(`observe_env_init '${value}'`, {
        env: { AGENTS_OBSERVE_DATA_ROOT: '', AGENTS_OBSERVE_LOCAL_DATA_ROOT: '', HOME: '' },
      })
      expect(code).toBe(2)
      expect(stderr).toMatch(/observe-env:/)
    })
  }

  it('rejects a root containing a newline', async () => {
    const { code } = await env('observe_env_init "$(printf \'/tmp/a\\nb\')"', {})
    expect(code).toBe(2)
  })
})

describe('defaults', () => {
  it('uses 30s grace, 15s start timeout, 0.2s poll', async () => {
    const root = dataRoot()
    const { stdout } = await env(
      'printf "%s %s %s\\n" "$OBSERVE_HEALTH_GRACE" "$OBSERVE_START_TIMEOUT" "$OBSERVE_START_POLL"',
      { dataRoot: root },
    )
    expect(stdout.trim()).toBe('30 15 0.2')
  })

  it('lets the environment override each default', async () => {
    const root = dataRoot()
    const { stdout } = await env(
      'printf "%s %s %s\\n" "$OBSERVE_HEALTH_GRACE" "$OBSERVE_START_TIMEOUT" "$OBSERVE_START_POLL"',
      {
        dataRoot: root,
        env: {
          AGENTS_OBSERVE_HEALTH_GRACE: '90',
          AGENTS_OBSERVE_START_TIMEOUT: '60',
          AGENTS_OBSERVE_START_POLL: '1',
        },
      },
    )
    expect(stdout.trim()).toBe('90 60 1')
  })
})

describe('observe_runtime_ensure', () => {
  it('creates the runtime dir only when asked', async () => {
    const root = dataRoot()
    await env(':', { dataRoot: root })
    expect(existsSync(join(root, 'runtime'))).toBe(false)

    const { code } = await env('observe_runtime_ensure', { dataRoot: root })
    expect(code).toBe(0)
    expect(existsSync(join(root, 'runtime'))).toBe(true)
  })

  it('refuses to run before observe_env_init', async () => {
    const { code } = await env('observe_runtime_ensure', { dataRoot: null })
    expect(code).toBe(2)
  })
})
