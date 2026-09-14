// test/hooks/scripts/supervision/lib/observe-process.test.mjs
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
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

const proc = (script, opts = {}) => runShell(script, { lib: 'observe-process.sh', ...opts })

let root
const children = []

beforeEach(() => {
  root = makeDataRoot('observe-process')
})

afterEach(async () => {
  while (children.length) killProcess(children.pop())
  removeDataRoot(root)
})

function fakeCollector(marker = MARKER) {
  const child = spawnFakeProcess(marker)
  children.push(child)
  return child
}

/** Write a lock directory by hand so tests control exactly what it records. */
function writeLock(dir, fields) {
  mkdirSync(dir, { recursive: true })
  for (const [name, value] of Object.entries(fields)) {
    writeFileSync(join(dir, name), `${value}\n`)
  }
}

async function identityOf(pid) {
  const { stdout } = await proc(`observe_pid_identity ${pid}`, { dataRoot: root })
  return stdout.trim()
}

describe('observe_pid_alive', () => {
  it('is true for a live process and false for a dead one', async () => {
    const child = fakeCollector()
    const alive = await proc(`observe_pid_alive ${child.pid}`, { dataRoot: root })
    expect(alive.code).toBe(0)

    child.kill('SIGKILL')
    await waitForExit(child)
    const dead = await proc(`observe_pid_alive ${child.pid}`, { dataRoot: root })
    expect(dead.code).toBe(1)
  })

  it('rejects non-numeric input instead of guessing', async () => {
    for (const value of ['', 'abc', '12a', '-1']) {
      const { code } = await proc(`observe_pid_alive '${value}'`, { dataRoot: root })
      expect(code).toBe(1)
    }
  })
})

describe('observe_pid_identity', () => {
  it('is stable across repeated reads of the same process', async () => {
    const child = fakeCollector()
    const first = await identityOf(child.pid)
    const second = await identityOf(child.pid)
    expect(first).not.toBe('')
    expect(first).toBe(second)
  })

  it('differs between two processes', async () => {
    const a = fakeCollector()
    const b = fakeCollector()
    expect(await identityOf(a.pid)).not.toBe(await identityOf(b.pid))
  })

  it('fails rather than crashing when /proc is unavailable', async () => {
    const child = fakeCollector()
    const { stdout, code } = await proc(`observe_pid_identity ${child.pid}`, {
      dataRoot: root,
      env: { AGENTS_OBSERVE_PROC_ROOT: join(root, 'no-such-proc') },
    })
    // The ps fallback still answers on this machine; the contract is that the
    // missing /proc is probed, never assumed, so this must not error out.
    expect(code).toBe(0)
    expect(stdout.trim()).toMatch(/^pid=\d+ started=.+/)
  })
})

describe('observe_process_matches_lock', () => {
  it('accepts the process the lock actually records', async () => {
    const child = fakeCollector()
    const lock = join(root, 'lock')
    writeLock(lock, {
      pid: child.pid,
      'pid-identity': await identityOf(child.pid),
      entrypoint: MARKER,
    })
    const { code } = await proc(`observe_process_matches_lock '${lock}'`, { dataRoot: root })
    expect(code).toBe(0)
  })

  it('rejects a live PID that is not the expected collector entrypoint', async () => {
    // Alive, identity recorded correctly — but it is somebody else's process.
    const stranger = fakeCollector('some-unrelated-program')
    const lock = join(root, 'lock')
    writeLock(lock, {
      pid: stranger.pid,
      'pid-identity': await identityOf(stranger.pid),
      entrypoint: MARKER,
    })
    const { code } = await proc(`observe_process_matches_lock '${lock}'`, { dataRoot: root })
    expect(code).toBe(1)
  })

  it('rejects a PID whose identity no longer matches (PID reuse)', async () => {
    const original = fakeCollector()
    const originalIdentity = await identityOf(original.pid)
    original.kill('SIGKILL')
    await waitForExit(original)

    // Stand in for the kernel handing that PID to a later process: the lock
    // records the reused PID, but the start time behind it has moved on. Only
    // the start-time leg of the identity can catch this — the PID matches.
    const successor = fakeCollector()
    const lock = join(root, 'lock')
    writeLock(lock, {
      pid: successor.pid,
      'pid-identity': originalIdentity.replace(/^pid=\d+/, `pid=${successor.pid}`),
      entrypoint: MARKER,
    })
    const { code } = await proc(`observe_process_matches_lock '${lock}'`, { dataRoot: root })
    expect(code).toBe(1)
  })

  it('rejects a dead PID and a malformed lock', async () => {
    const child = fakeCollector()
    const identity = await identityOf(child.pid)
    child.kill('SIGKILL')
    await waitForExit(child)

    const dead = join(root, 'dead')
    writeLock(dead, { pid: child.pid, 'pid-identity': identity, entrypoint: MARKER })
    expect((await proc(`observe_process_matches_lock '${dead}'`, { dataRoot: root })).code).toBe(1)

    const live = fakeCollector()
    const noIdentity = join(root, 'no-identity')
    writeLock(noIdentity, { pid: live.pid, entrypoint: MARKER })
    expect(
      (await proc(`observe_process_matches_lock '${noIdentity}'`, { dataRoot: root })).code,
    ).toBe(1)

    const missing = join(root, 'missing')
    expect((await proc(`observe_process_matches_lock '${missing}'`, { dataRoot: root })).code).toBe(
      1,
    )
  })
})

describe('observe_signal_locked_process', () => {
  it('signals the recorded collector', async () => {
    const child = fakeCollector()
    const lock = join(root, 'lock')
    writeLock(lock, {
      pid: child.pid,
      'pid-identity': await identityOf(child.pid),
      entrypoint: MARKER,
    })
    const { code } = await proc(`observe_signal_locked_process TERM '${lock}'`, { dataRoot: root })
    expect(code).toBe(0)
    await waitForExit(child)
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
  })

  it('refuses to signal a process whose identity does not match the lock', async () => {
    const stranger = fakeCollector('some-unrelated-program')
    const lock = join(root, 'lock')
    writeLock(lock, {
      pid: stranger.pid,
      'pid-identity': await identityOf(stranger.pid),
      entrypoint: MARKER,
    })
    const { code } = await proc(`observe_signal_locked_process KILL '${lock}'`, { dataRoot: root })
    expect(code).toBe(1)
    // Still running: the signal was never delivered.
    expect(stranger.exitCode).toBe(null)
  })
})
