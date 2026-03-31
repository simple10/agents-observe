// hooks/scripts/lib/logger.mjs
// Structured file + console logger for Agents Observe hooks.
// No dependencies - uses only Node.js built-ins.

import { appendFileSync, statSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, sep, resolve, basename, dirname } from 'node:path'

const MAX_LOG_SIZE = 1_048_576 // 1MB
const PRUNE_TARGET = 524_288 // 500KB — keep the tail

/**
 * Creates a logger that writes to both a log file and console (stderr).
 *
 * File output: error/warn always; info/debug/trace only when logLevel is debug|trace.
 * Console output: error/warn/info always; debug/trace only when logLevel is debug|trace.
 */
export function createLogger(filename, config) {
  const logLevel = config.logLevel
  const verbose = logLevel === 'debug' || logLevel === 'trace'

  const full = resolve(config.logsDir, filename)
  const safeDir = resolve(config.logsDir) + sep
  const logFile = full.startsWith(safeDir) ? full : join(config.logsDir, basename(filename))

  let dirCreated = false

  function ensureDir() {
    if (!dirCreated) {
      mkdirSync(dirname(logFile), { recursive: true })
      dirCreated = true
    }
  }

  function pruneIfNeeded() {
    try {
      const stat = statSync(logFile)
      if (stat.size > MAX_LOG_SIZE) {
        const content = readFileSync(logFile, 'utf8')
        const tail = content.slice(-PRUNE_TARGET)
        // Start from the first complete line
        const firstNewline = tail.indexOf('\n')
        const pruned = firstNewline >= 0 ? tail.slice(firstNewline + 1) : tail
        writeFileSync(logFile, pruned)
      }
    } catch {
      // File doesn't exist yet — nothing to prune
    }
  }

  function writeToFile(level, msg) {
    ensureDir()
    pruneIfNeeded()
    const timestamp = new Date().toISOString()
    const line = `${timestamp} [${level}] ${msg}\n`
    appendFileSync(logFile, line)
  }

  return {
    error(msg) {
      writeToFile('ERROR', msg)
      console.error(`[agents-observe] ${msg}`)
    },
    warn(msg) {
      writeToFile('WARN', msg)
      console.error(`[agents-observe] ${msg}`)
    },
    info(msg) {
      if (verbose) writeToFile('INFO', msg)
      console.error(`[agents-observe] ${msg}`)
    },
    debug(msg) {
      if (!verbose) return
      writeToFile('DEBUG', msg)
      console.error(`[agents-observe] ${msg}`)
    },
    trace(msg) {
      if (!verbose) return
      writeToFile('TRACE', msg)
      console.error(`[agents-observe] ${msg}`)
    },
  }
}
