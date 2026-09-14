// test/hooks/scripts/supervision/helpers.mjs
// Shared harness for exercising the bash supervision primitives from vitest.
// Each helper runs a real bash process so the tests cover the shipped code
// path, not a reimplementation of it.

import { execFile, spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const here = dirname(fileURLToPath(import.meta.url))

export const REPO_ROOT = resolve(here, '../../../../')
export const LIB_DIR = join(REPO_ROOT, 'hooks/scripts/supervision/lib')
export const HEALTH_CLI = join(REPO_ROOT, 'hooks/scripts/supervision/observe-health.sh')

/** Marker the fake collectors below carry in their command line. */
export const MARKER = 'agents-observe-collector'

/**
 * Run a bash snippet with the supervision libs already sourced and the env
 * initialized against `dataRoot`. Resolves with { stdout, stderr, code }
 * regardless of exit status so tests can assert on failures too.
 */
export async function runShell(script, { dataRoot, env = {}, lib = 'observe-heartbeat.sh' } = {}) {
  const prelude = [
    'set -u',
    `. '${join(LIB_DIR, lib)}'`,
    dataRoot ? 'observe_env_init || exit 2' : ':',
  ].join('\n')

  try {
    const { stdout, stderr } = await execFileAsync('bash', ['-c', `${prelude}\n${script}`], {
      env: {
        ...process.env,
        AGENTS_OBSERVE_DATA_ROOT: dataRoot ?? '',
        // Keep the default HTTP leg out of unit tests unless a case opts in.
        AGENTS_OBSERVE_HEALTH_URL: '',
        ...env,
      },
    })
    return { stdout, stderr, code: 0 }
  } catch (err) {
    return { stdout: err.stdout ?? '', stderr: err.stderr ?? '', code: err.code ?? 1 }
  }
}

/** Run observe-health.sh against a data root. */
export async function runHealth(dataRoot, { env = {}, args = [] } = {}) {
  const options = {
    env: {
      ...process.env,
      AGENTS_OBSERVE_DATA_ROOT: dataRoot ?? '',
      AGENTS_OBSERVE_HEALTH_URL: '',
      ...env,
    },
  }
  try {
    const { stdout, stderr } = await execFileAsync(HEALTH_CLI, args, options)
    return { stdout: stdout.trim(), stderr, code: 0 }
  } catch (err) {
    return { stdout: (err.stdout ?? '').trim(), stderr: err.stderr ?? '', code: err.code ?? 1 }
  }
}

/** Create a throwaway data root; returns its path. */
export function makeDataRoot(label = 'observe-sup') {
  return mkdtempSync(join(tmpdir(), `${label}-`))
}

export function removeDataRoot(path) {
  if (path) rmSync(path, { recursive: true, force: true })
}

/**
 * Spawn a long-lived process whose command line carries `marker`. The trailing
 * shell comment is what puts the marker in argv without changing behaviour —
 * it stands in for the collector's real entrypoint flag.
 */
export function spawnFakeProcess(marker = MARKER) {
  const child = spawn(
    'bash',
    ['-c', `trap 'exit 0' TERM INT; while true; do sleep 0.2; done # ${marker}`],
    { stdio: 'ignore' },
  )
  child.unref()
  return child
}

export function killProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  try {
    child.kill('SIGKILL')
  } catch {
    // already gone
  }
}

/** Resolves once the spawned child has actually exited. */
export function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((res) => child.once('exit', () => res()))
}

/** Poll until `check()` returns truthy, or throw after `timeoutMs`. */
export async function waitFor(check, { timeoutMs = 3000, intervalMs = 25 } = {}) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await check()) return
    if (Date.now() > deadline) throw new Error('waitFor: timed out')
    await new Promise((res) => setTimeout(res, intervalMs))
  }
}
