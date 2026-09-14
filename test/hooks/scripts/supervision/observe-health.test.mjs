// test/hooks/scripts/supervision/observe-health.test.mjs
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import {
  runShell,
  runHealth,
  makeDataRoot,
  removeDataRoot,
  spawnFakeProcess,
  killProcess,
  waitForExit,
  MARKER,
} from './helpers.mjs'

let root
const children = []

beforeEach(() => {
  root = makeDataRoot('observe-health')
})

afterEach(() => {
  while (children.length) killProcess(children.pop())
  removeDataRoot(root)
})

function fakeCollector(marker = MARKER) {
  const child = spawnFakeProcess(marker)
  children.push(child)
  return child
}

const runtimeDir = () => join(root, 'runtime')
const lockDir = () => join(runtimeDir(), 'collector.lock')

async function makeHealthy(pid, instance = 'inst-1') {
  return runShell(
    `observe_runtime_ensure &&
     observe_collector_lock_claim '${instance}' ${pid} &&
     observe_heartbeat_publish '${instance}' ${pid}`,
    { dataRoot: root },
  )
}

describe('observe-health.sh output shapes', () => {
  it('reports healthy with pid, heartbeat age and http state, exit 0', async () => {
    const child = fakeCollector()
    await makeHealthy(child.pid)
    const { stdout, code } = await runHealth(root)
    expect(stdout).toMatch(/^collector: healthy pid=\d+ heartbeat=\d+s http=(ok|skipped)$/)
    expect(stdout).toContain(`pid=${child.pid}`)
    expect(code).toBe(0)
  })

  it('reports absent with exit 1 when there is no collector', async () => {
    const { stdout, code } = await runHealth(root)
    expect(stdout).toBe('collector: absent')
    expect(code).toBe(1)
  })

  it('reports unhealthy with a reason and pid, exit 1', async () => {
    const child = fakeCollector()
    await makeHealthy(child.pid)
    const stale = Math.floor(Date.now() / 1000) - 900
    writeFileSync(
      join(runtimeDir(), 'collector.heartbeat'),
      `instanceId=inst-1\npid=${child.pid}\nupdatedAt=${stale}\n`,
    )
    const { stdout, code } = await runHealth(root)
    expect(stdout).toBe(`collector: unhealthy reason=stale-heartbeat pid=${child.pid}`)
    expect(code).toBe(1)
  })

  it('reports invalid-owner with exit 2 on a reused pid', async () => {
    const child = fakeCollector()
    await makeHealthy(child.pid)
    child.kill('SIGKILL')
    await waitForExit(child)

    const successor = fakeCollector()
    writeFileSync(join(lockDir(), 'pid'), `${successor.pid}\n`)
    writeFileSync(
      join(lockDir(), 'pid-identity'),
      `pid=${successor.pid} starttime=1 exe=/bin/bash\n`,
    )

    const { stdout, code } = await runHealth(root)
    expect(stdout).toBe(
      `collector: invalid-owner reason=pid-identity-mismatch pid=${successor.pid}`,
    )
    expect(code).toBe(2)
  })

  it('exits 2 on an unsafe data root', async () => {
    const { code, stderr } = await runHealth('relative/not/absolute')
    expect(code).toBe(2)
    expect(stderr).toMatch(/unsafe data root/)
  })

  it('exits 2 on an unknown argument', async () => {
    const { code } = await runHealth(root, { args: ['--wat'] })
    expect(code).toBe(2)
  })

  it('honours --data-root over the environment', async () => {
    const other = makeDataRoot('observe-health-other')
    try {
      const child = fakeCollector()
      await makeHealthy(child.pid)
      const { stdout, code } = await runHealth(root, { args: ['--data-root', other] })
      expect(stdout).toBe('collector: absent')
      expect(code).toBe(1)
    } finally {
      removeDataRoot(other)
    }
  })
})

describe('observe-health.sh never mutates state', () => {
  it('leaves an abandoned lock exactly as it found it', async () => {
    const child = fakeCollector()
    await makeHealthy(child.pid)
    child.kill('SIGKILL')
    await waitForExit(child)

    const before = readdirSync(lockDir()).sort()
    const { code } = await runHealth(root)
    expect(code).toBe(1)
    expect(existsSync(lockDir())).toBe(true)
    expect(readdirSync(lockDir()).sort()).toEqual(before)
  })

  it('does not create the runtime dir when checking a cold data root', async () => {
    await runHealth(root)
    expect(existsSync(runtimeDir())).toBe(false)
  })

  it('does not signal the process it reports on', async () => {
    const child = fakeCollector()
    await makeHealthy(child.pid)
    await runHealth(root)
    await new Promise((res) => setTimeout(res, 300))
    expect(child.exitCode).toBe(null)
    expect(child.signalCode).toBe(null)
  })
})
