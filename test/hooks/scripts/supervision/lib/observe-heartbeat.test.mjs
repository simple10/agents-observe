// test/hooks/scripts/supervision/lib/observe-heartbeat.test.mjs
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

import {
  runShell,
  makeDataRoot,
  removeDataRoot,
  spawnFakeProcess,
  killProcess,
  waitForExit,
  MARKER,
} from '../helpers.mjs'

const beat = (script, opts = {}) => runShell(script, { lib: 'observe-heartbeat.sh', ...opts })

let root
const children = []

beforeEach(() => {
  root = makeDataRoot('observe-heartbeat')
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
const heartbeatPath = () => join(runtimeDir(), 'collector.heartbeat')

/** Bring a data root to a healthy state: lock claimed + fresh heartbeat. */
async function makeHealthy(pid, instance = 'inst-1') {
  return beat(
    `observe_runtime_ensure &&
     observe_collector_lock_claim '${instance}' ${pid} &&
     observe_heartbeat_publish '${instance}' ${pid}`,
    { dataRoot: root },
  )
}

/** Rewrite the heartbeat with an explicit age in seconds. */
function writeHeartbeat({ instance = 'inst-1', pid = 1, ageSeconds = 0 } = {}) {
  mkdirSync(runtimeDir(), { recursive: true })
  const updatedAt = Math.floor(Date.now() / 1000) - ageSeconds
  writeFileSync(heartbeatPath(), `instanceId=${instance}\npid=${pid}\nupdatedAt=${updatedAt}\n`)
}

describe('observe_heartbeat_age / fresh', () => {
  it('reports a small age for a just-published heartbeat', async () => {
    const { stdout, code } = await beat(
      "observe_runtime_ensure && observe_heartbeat_publish 'inst-1' && observe_heartbeat_age",
      { dataRoot: root },
    )
    expect(code).toBe(0)
    expect(Number(stdout.trim())).toBeLessThan(5)
  })

  it('reports the unknown sentinel and fails when there is no heartbeat', async () => {
    const { stdout, code } = await beat('observe_heartbeat_age', { dataRoot: root })
    expect(code).toBe(1)
    expect(stdout.trim()).toBe('999999')
  })

  it('falls back to mtime when updatedAt is unusable', async () => {
    mkdirSync(runtimeDir(), { recursive: true })
    writeFileSync(heartbeatPath(), 'instanceId=inst-1\nupdatedAt=not-a-number\n')
    const { stdout, code } = await beat('observe_heartbeat_age', { dataRoot: root })
    expect(code).toBe(0)
    expect(Number(stdout.trim())).toBeLessThan(5)
  })

  it('is fresh inside the grace window and stale outside it', async () => {
    writeHeartbeat({ ageSeconds: 2 })
    expect((await beat('observe_heartbeat_fresh', { dataRoot: root })).code).toBe(0)

    writeHeartbeat({ ageSeconds: 120 })
    expect((await beat('observe_heartbeat_fresh', { dataRoot: root })).code).toBe(1)
    // The grace window is configurable, and a wider one accepts the same beat.
    expect((await beat('observe_heartbeat_fresh 600', { dataRoot: root })).code).toBe(0)
  })

  it('clamps a heartbeat stamped in the future to age 0 rather than going negative', async () => {
    writeHeartbeat({ ageSeconds: -500 })
    const { stdout } = await beat('observe_heartbeat_age', { dataRoot: root })
    expect(stdout.trim()).toBe('0')
  })
})

describe('observe_heartbeat_matches_lock', () => {
  it('matches when heartbeat and lock name the same instance', async () => {
    const child = fakeCollector()
    await makeHealthy(child.pid, 'inst-1')
    expect((await beat('observe_heartbeat_matches_lock', { dataRoot: root })).code).toBe(0)
  })

  it('does not match a fresh heartbeat from a different instance', async () => {
    const child = fakeCollector()
    await makeHealthy(child.pid, 'inst-1')
    writeHeartbeat({ instance: 'inst-2', pid: child.pid })
    expect((await beat('observe_heartbeat_matches_lock', { dataRoot: root })).code).toBe(1)
  })

  it('does not treat two blank instance ids as a match', async () => {
    mkdirSync(join(runtimeDir(), 'collector.lock'), { recursive: true })
    writeFileSync(join(runtimeDir(), 'collector.lock/instance-id'), '\n')
    writeFileSync(heartbeatPath(), 'instanceId=\nupdatedAt=0\n')
    expect((await beat('observe_heartbeat_matches_lock', { dataRoot: root })).code).toBe(1)
  })
})

describe('observe_collector_healthy', () => {
  const status = async (dataRoot = root, env = {}) => {
    const { stdout, code } = await beat(
      'observe_collector_healthy; rc=$?; printf "%s %s %s\\n" "$OBSERVE_HEALTH_STATUS" "${OBSERVE_HEALTH_REASON:-none}" "$OBSERVE_HEALTH_HTTP"; exit $rc',
      { dataRoot, env },
    )
    const [state, reason, http] = stdout.trim().split(' ')
    return { state, reason, http, code }
  }

  it('is healthy with a live identity-matched collector and a fresh matching heartbeat', async () => {
    const child = fakeCollector()
    await makeHealthy(child.pid)
    expect(await status()).toEqual({ state: 'healthy', reason: 'none', http: 'skipped', code: 0 })
  })

  it('is absent with no lock', async () => {
    expect(await status()).toMatchObject({ state: 'absent', code: 1 })
  })

  it('is unhealthy with a stale heartbeat', async () => {
    const child = fakeCollector()
    await makeHealthy(child.pid)
    writeHeartbeat({ instance: 'inst-1', pid: child.pid, ageSeconds: 900 })
    expect(await status()).toMatchObject({ state: 'unhealthy', reason: 'stale-heartbeat', code: 1 })
  })

  it('is unhealthy with no heartbeat at all', async () => {
    const child = fakeCollector()
    await beat(`observe_runtime_ensure && observe_collector_lock_claim 'inst-1' ${child.pid}`, {
      dataRoot: root,
    })
    expect(await status()).toMatchObject({
      state: 'unhealthy',
      reason: 'missing-heartbeat',
      code: 1,
    })
  })

  it('is unhealthy, not invalid, when the owner is simply dead', async () => {
    const child = fakeCollector()
    await makeHealthy(child.pid)
    child.kill('SIGKILL')
    await waitForExit(child)
    expect(await status()).toMatchObject({ state: 'unhealthy', reason: 'dead-pid', code: 1 })
  })

  it('is invalid-owner when the PID was reused by another process', async () => {
    const child = fakeCollector()
    await makeHealthy(child.pid)
    const lockDir = join(runtimeDir(), 'collector.lock')
    child.kill('SIGKILL')
    await waitForExit(child)

    const successor = fakeCollector()
    writeFileSync(join(lockDir, 'pid'), `${successor.pid}\n`)
    writeFileSync(join(lockDir, 'pid-identity'), `pid=${successor.pid} starttime=1 exe=/bin/bash\n`)

    expect(await status()).toMatchObject({
      state: 'invalid-owner',
      reason: 'pid-identity-mismatch',
      code: 2,
    })
  })

  it('is invalid-owner when a fresh heartbeat names a different instance', async () => {
    const child = fakeCollector()
    await makeHealthy(child.pid, 'inst-1')
    writeHeartbeat({ instance: 'inst-2', pid: child.pid })
    expect(await status()).toMatchObject({
      state: 'invalid-owner',
      reason: 'instance-mismatch',
      code: 2,
    })
  })

  it('is invalid-owner when the lock belongs to a different data root', async () => {
    const child = fakeCollector()
    await makeHealthy(child.pid)
    writeFileSync(join(runtimeDir(), 'collector.lock/data-root'), '/somewhere/else\n')
    expect(await status()).toMatchObject({
      state: 'invalid-owner',
      reason: 'data-root-mismatch',
      code: 2,
    })
  })

  it('is invalid-owner when the live process is not the collector entrypoint', async () => {
    const stranger = fakeCollector('some-unrelated-program')
    await makeHealthy(stranger.pid)
    expect(await status()).toMatchObject({
      state: 'invalid-owner',
      reason: 'entrypoint-mismatch',
      code: 2,
    })
  })

  it('is invalid-owner when the lock records no usable identity', async () => {
    mkdirSync(join(runtimeDir(), 'collector.lock'), { recursive: true })
    writeFileSync(join(runtimeDir(), 'collector.lock/pid'), 'not-a-pid\n')
    expect(await status()).toMatchObject({
      state: 'invalid-owner',
      reason: 'malformed-lock',
      code: 2,
    })
  })

  it('fails health when a configured HTTP endpoint does not answer', async () => {
    const child = fakeCollector()
    await makeHealthy(child.pid)
    // Port 1 on loopback refuses immediately, so this stays fast.
    expect(
      await status(root, {
        AGENTS_OBSERVE_HEALTH_URL: 'http://127.0.0.1:1/api/health',
        AGENTS_OBSERVE_HEALTH_HTTP_TIMEOUT: '1',
      }),
    ).toMatchObject({ state: 'unhealthy', reason: 'http-unhealthy', http: 'failed', code: 1 })
  })
})
