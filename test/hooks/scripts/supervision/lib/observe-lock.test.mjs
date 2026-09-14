// test/hooks/scripts/supervision/lib/observe-lock.test.mjs
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, writeFileSync, readFileSync } from 'node:fs'
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

const lock = (script, opts = {}) => runShell(script, { lib: 'observe-lock.sh', ...opts })

let root
const children = []

beforeEach(() => {
  root = makeDataRoot('observe-lock')
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

/** Claim the collector lock on behalf of an already-running fake collector. */
async function claim(pid, { instance = 'inst-1', dataRoot = root } = {}) {
  return lock(`observe_runtime_ensure && observe_collector_lock_claim '${instance}' ${pid}`, {
    dataRoot,
  })
}

describe('atomic acquisition', () => {
  it('never lets two racing acquirers both win the start lock', async () => {
    // Eight processes claim the same lock at the same moment, over many
    // rounds. Exactly one may win each round; a check-then-write claim — or a
    // claim resting on the host mkdir alone — double-succeeds here.
    const racers = 8
    const script = `
      observe_runtime_ensure
      for i in $(seq 1 20); do
        rm -rf "$OBSERVE_START_LOCK"
        pids=''
        out="$OBSERVE_DATA_ROOT/race.$i"
        attempts="$OBSERVE_DATA_ROOT/attempts.$i"
        : > "$out"
        : > "$attempts"
        for r in $(seq 1 ${racers}); do
          (
            if observe_start_lock_try_acquire; then printf 'won\\n' >> "$out"; fi
            printf 'done\\n' >> "$attempts"
            # Hold the claim until every racer has finished attempting. A
            # winner that exited first would be a legitimately dead owner, and
            # a straggler reclaiming it is correct behaviour that would just
            # muddy what this test measures.
            n=0
            while [ "$(wc -l < "$attempts")" -lt ${racers} ] && [ "$n" -lt 200 ]; do
              sleep 0.05
              n=$((n + 1))
            done
          ) &
          pids="$pids $!"
        done
        for p in $pids; do wait "$p"; done
        winners=$(wc -l < "$out" | tr -d ' ')
        if [ "$winners" != "1" ]; then
          printf 'round %s had %s winners\\n' "$i" "$winners"
          exit 1
        fi
      done
      printf 'ok\\n'
    `
    const { stdout, code } = await lock(script, { dataRoot: root })
    expect(stdout.trim()).toBe('ok')
    expect(code).toBe(0)
  }, 60000)

  it('gates the claim on an O_EXCL write, not on the host mkdir binary', async () => {
    // The directory can already exist — a correct mkdir is not what makes the
    // claim exclusive, and on some hosts (uutils coreutils 0.8.0) mkdir reports
    // success to several concurrent creators of the same directory.
    const script = `
      observe_runtime_ensure
      mkdir -p "$OBSERVE_START_LOCK"
      observe_lock_claim_pid "$OBSERVE_START_LOCK" 4242 || { printf 'first-failed\\n'; exit 1; }
      # A second claim against the same directory must lose.
      observe_lock_claim_pid "$OBSERVE_START_LOCK" 4343 && { printf 'second-won\\n'; exit 1; }
      printf '%s\\n' "$(cat "$OBSERVE_START_LOCK/pid")"
    `
    const { stdout } = await lock(script, { dataRoot: root })
    expect(stdout.trim()).toBe('4242')
  })

  it('releases only for the owning process', async () => {
    const script = `
      observe_runtime_ensure
      observe_start_lock_try_acquire || exit 1
      # A different process must not be able to release it.
      ( observe_start_lock_release ) && printf 'stranger-released\\n'
      [ -d "$OBSERVE_START_LOCK" ] || { printf 'gone-too-early\\n'; exit 1; }
      observe_start_lock_release || exit 1
      [ -d "$OBSERVE_START_LOCK" ] && { printf 'still-there\\n'; exit 1; }
      printf 'ok\\n'
    `
    const { stdout } = await lock(script, { dataRoot: root })
    expect(stdout.trim()).toBe('ok')
  })

  it('lets a start lock be re-acquired after its holder is gone', async () => {
    const script = `
      observe_runtime_ensure
      observe_start_lock_try_acquire || exit 1
      observe_start_lock_release || exit 1
      observe_start_lock_try_acquire || exit 1
      printf 'ok\\n'
    `
    const { stdout } = await lock(script, { dataRoot: root })
    expect(stdout.trim()).toBe('ok')
  })
})

describe('data-root isolation', () => {
  it('keeps two data roots from seeing the other lock state', async () => {
    const other = makeDataRoot('observe-lock-other')
    try {
      const a = fakeCollector()
      const b = fakeCollector()

      expect((await claim(a.pid, { instance: 'inst-a' })).code).toBe(0)
      expect((await claim(b.pid, { instance: 'inst-b', dataRoot: other })).code).toBe(0)

      expect(existsSync(join(root, 'runtime/collector.lock'))).toBe(true)
      expect(existsSync(join(other, 'runtime/collector.lock'))).toBe(true)

      const inA = await lock('observe_collector_lock_snapshot', { dataRoot: root })
      const inB = await lock('observe_collector_lock_snapshot', { dataRoot: other })
      expect(inA.stdout).toContain('instance-id=inst-a')
      expect(inA.stdout).toContain(`data-root=${root}`)
      expect(inB.stdout).toContain('instance-id=inst-b')
      expect(inB.stdout).toContain(`data-root=${other}`)

      // Ownership never leaks across roots.
      expect(
        (await lock("observe_collector_lock_owned_by 'inst-b'", { dataRoot: root })).code,
      ).toBe(1)
      expect(
        (await lock("observe_collector_lock_owned_by 'inst-a'", { dataRoot: root })).code,
      ).toBe(0)

      // Reclaiming in one root leaves the other alone.
      a.kill('SIGKILL')
      await waitForExit(a)
      expect((await lock('observe_collector_lock_reclaim', { dataRoot: root })).code).toBe(0)
      expect(existsSync(join(root, 'runtime/collector.lock'))).toBe(false)
      expect(existsSync(join(other, 'runtime/collector.lock'))).toBe(true)
    } finally {
      removeDataRoot(other)
    }
  })
})

describe('abandonment', () => {
  it('does not call a live, identity-matched lock abandoned however old it looks', async () => {
    const child = fakeCollector()
    expect((await claim(child.pid)).code).toBe(0)

    // Backdate every timestamp the lock carries. Age must not be evidence.
    const lockDir = join(root, 'runtime/collector.lock')
    writeFileSync(join(lockDir, 'started-at'), '1\n')

    expect((await lock('observe_collector_lock_is_abandoned', { dataRoot: root })).code).toBe(1)
    expect((await lock('observe_collector_lock_reclaim', { dataRoot: root })).code).toBe(1)
    expect(existsSync(lockDir)).toBe(true)
  })

  it('treats a dead owner as abandoned', async () => {
    const child = fakeCollector()
    expect((await claim(child.pid)).code).toBe(0)
    child.kill('SIGKILL')
    await waitForExit(child)

    expect((await lock('observe_collector_lock_is_abandoned', { dataRoot: root })).code).toBe(0)
    expect((await lock('observe_collector_lock_reclaim', { dataRoot: root })).code).toBe(0)
    expect(existsSync(join(root, 'runtime/collector.lock'))).toBe(false)
  })

  it('treats a reused PID as abandoned, not as a live owner', async () => {
    const original = fakeCollector()
    expect((await claim(original.pid)).code).toBe(0)
    const lockDir = join(root, 'runtime/collector.lock')
    const recordedIdentity = readFileSync(join(lockDir, 'pid-identity'), 'utf8').trim()

    original.kill('SIGKILL')
    await waitForExit(original)

    // The PID now belongs to a different process. Point the lock at that live
    // PID while keeping the original start time: PID alone would call this
    // healthy, identity must not.
    const successor = fakeCollector()
    writeFileSync(join(lockDir, 'pid'), `${successor.pid}\n`)
    writeFileSync(
      join(lockDir, 'pid-identity'),
      `${recordedIdentity.replace(/^pid=\d+/, `pid=${successor.pid}`)}\n`,
    )

    expect(
      (await lock(`observe_pid_alive "$(cat '${lockDir}/pid')"`, { dataRoot: root })).code,
    ).toBe(0)
    expect((await lock('observe_collector_lock_is_abandoned', { dataRoot: root })).code).toBe(0)
  })

  it('treats a live PID that is not the collector as abandoned', async () => {
    const stranger = fakeCollector('some-unrelated-program')
    expect((await claim(stranger.pid)).code).toBe(0)
    // The claim recorded the real marker as the expected entrypoint, but this
    // process does not carry it.
    expect((await lock('observe_collector_lock_is_abandoned', { dataRoot: root })).code).toBe(0)
  })
})

describe('observe_collector_lock_claim', () => {
  it('records identity, entrypoint, data root and instance', async () => {
    const child = fakeCollector()
    expect((await claim(child.pid, { instance: 'inst-x' })).code).toBe(0)
    const { stdout } = await lock('observe_collector_lock_snapshot', { dataRoot: root })
    expect(stdout).toContain(`pid=${child.pid}`)
    expect(stdout).toContain(`entrypoint=${MARKER}`)
    expect(stdout).toContain('instance-id=inst-x')
    expect(stdout).toMatch(/pid-identity=pid=\d+ /)
    expect(stdout).toMatch(/started-at=\d+/)
  })

  it('refuses a second claim while the first lock stands', async () => {
    const first = fakeCollector()
    const second = fakeCollector()
    expect((await claim(first.pid, { instance: 'inst-1' })).code).toBe(0)
    expect((await claim(second.pid, { instance: 'inst-2' })).code).toBe(1)
    const { stdout } = await lock('observe_collector_lock_snapshot', { dataRoot: root })
    expect(stdout).toContain('instance-id=inst-1')
  })

  it('reports no lock at all', async () => {
    const { code, stdout } = await lock('observe_collector_lock_snapshot', { dataRoot: root })
    expect(code).toBe(1)
    expect(stdout.trim()).toBe('')
  })
})
