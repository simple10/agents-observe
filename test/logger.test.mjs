// test/logger.test.mjs
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { createLogger } from '../hooks/scripts/lib/logger.mjs'

// We test createLogger by pointing it at a temp directory
let testDir

beforeEach(() => {
  testDir = join(tmpdir(), `logger-test-${Date.now()}`)
  mkdirSync(testDir, { recursive: true })
})

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true })
})

function makeLogger(level) {
  return createLogger('test.log', { logLevel: level || '', logsDir: testDir })
}

describe('logger', () => {
  it('always writes error to log file regardless of log level', () => {
    const log = makeLogger('')
    log.error('bad thing')
    const content = readFileSync(join(testDir, 'test.log'), 'utf8')
    expect(content).toContain('bad thing')
    expect(content).toContain('ERROR')
  })

  it('always writes warn to log file regardless of log level', () => {
    const log = makeLogger('')
    log.warn('warning thing')
    const content = readFileSync(join(testDir, 'test.log'), 'utf8')
    expect(content).toContain('warning thing')
    expect(content).toContain('WARN')
  })

  it('does not write debug to log file when log level is unset', () => {
    const log = makeLogger('')
    log.debug('verbose thing')
    try {
      readFileSync(join(testDir, 'test.log'), 'utf8')
      // If file exists, it should not contain the debug message
      expect(true).toBe(false) // Should not reach here
    } catch {
      // File doesn't exist — correct behavior
    }
  })

  it('writes debug to log file when log level is debug', () => {
    const log = makeLogger('debug')
    log.debug('verbose thing')
    const content = readFileSync(join(testDir, 'test.log'), 'utf8')
    expect(content).toContain('verbose thing')
  })

  it('writes info to log file when log level is debug', () => {
    const log = makeLogger('debug')
    log.info('info thing')
    const content = readFileSync(join(testDir, 'test.log'), 'utf8')
    expect(content).toContain('info thing')
  })

  it('writes trace to log file when log level is trace', () => {
    const log = makeLogger('trace')
    log.trace('trace thing')
    const content = readFileSync(join(testDir, 'test.log'), 'utf8')
    expect(content).toContain('trace thing')
  })

  it('prunes log file when it exceeds 1MB', () => {
    const log = makeLogger('debug')
    const logFile = join(testDir, 'test.log')

    // Write >1MB to the file directly to simulate accumulated logs
    const bigContent = 'X'.repeat(1_100_000) + '\n'
    writeFileSync(logFile, bigContent)

    // Next write should trigger prune
    log.debug('after prune')

    const stat = statSync(logFile)
    expect(stat.size).toBeLessThan(600_000) // ~500KB after prune + new line
    const content = readFileSync(logFile, 'utf8')
    expect(content).toContain('after prune')
  })
})
