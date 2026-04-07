import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Validates a file or directory path to protect against mangled or dangerous values.
 * @param {string} raw - file or dir path
 * @param {string} [label] - human-readable label for error messages (e.g. 'dataDir')
 * @returns {string} resolved absolute path
 * @throws if the path is empty, dangerous, or obviously wrong
 */
export function validatePath(raw, label = 'path') {
  if (!raw?.trim()) {
    throw new Error(`${label} is empty or undefined`)
  }

  // Null bytes — Node throws on these but with a cryptic error
  if (raw.includes('\0')) {
    throw new Error(`${label} contains null bytes: ${raw}`)
  }

  // Catch obviously wrong values like URLs, flags, etc.
  if (/^https?:\/\/|^--/.test(raw)) {
    throw new Error(`${label} looks like a URL or flag, not a path: "${raw}"`)
  }

  const resolved = resolve(raw)

  // Prevent creating dirs at the filesystem root
  if (resolved === '/') {
    throw new Error(`${label} resolves to filesystem root (/): "${raw}"`)
  }

  return resolved
}

/**
 * Validates and creates local data directories.
 * Validates all paths before creating any to avoid partial state on error.
 *
 * @param {object} config - needs localDataRootDir, dataDir, logsDir
 * @throws if any path is empty, dangerous, or resolves to /
 */
export function ensureLocalDataDirs(config) {
  const rootDir = validatePath(config.localDataRootDir, 'localDataRootDir')
  const dataDir = validatePath(config.dataDir, 'dataDir')
  const logsDir = validatePath(config.logsDir, 'logsDir')

  mkdirSync(rootDir, { recursive: true })
  mkdirSync(dataDir, { recursive: true })
  mkdirSync(logsDir, { recursive: true })
}

/**
 * Resolve the plugin data directory, working around a Claude Code bug where
 * CLAUDE_PLUGIN_DATA can be set to the wrong plugin during skill invocations.
 *
 * @param {object} config - needs pluginDataDir, pluginName, homeDir, serverPortFileName
 * @returns {string|null} the valid path or null
 */
export function resolvePluginDataDir(config) {
  const { pluginDataDir, pluginName } = config

  // Return the plugin data dir if it correctly includes the plugin name
  if (pluginDataDir && pluginDataDir.includes(pluginName)) {
    return pluginDataDir
  }

  if (!config.homeDir) {
    return null
  }

  // CLAUDE_PLUGIN_DATA is missing or points to the wrong plugin.
  // Derive the correct path from the standard plugins data directory.
  const pluginsDataRoot = resolve(config.homeDir, '.claude/plugins/data')

  // Try known suffixes: inline (--plugin-dir) and bare
  for (const suffix of [`${pluginName}-inline`, pluginName]) {
    const candidate = resolve(pluginsDataRoot, suffix)
    try {
      readFileSync(resolve(candidate, config.serverPortFileName), 'utf8')
      return candidate
    } catch {
      // not this one, try next
    }
  }
  return null
}

/**
 * Read the local server port file created when server starts
 * @param {object} config - needs serverPortFile
 * @returns {string|null} port string or null
 */
export function readServerPortFile(config) {
  try {
    return readFileSync(config.serverPortFile, 'utf8').trim() || null
  } catch {
    return null
  }
}

export function saveServerPortFile(config, port) {
  writeFileSync(config.serverPortFile, String(port))
}

export function removeServerPortFile(config) {
  try {
    unlinkSync(config.serverPortFile)
  } catch {
    /* already gone */
  }
}

/**
 * Remove the SQLite database and its WAL/SHM journal files.
 * @param {object} config - needs dataDir
 * @returns {{ removed: string[], missing: string[] }} files that were removed vs already absent
 */
export function removeDatabase(config) {
  const dbPath = resolve(config.dataDir, config.databaseFileName)
  const files = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, `${dbPath}-journal`]
  const removed = []
  const missing = []

  for (const f of files) {
    if (existsSync(f)) {
      unlinkSync(f)
      removed.push(f)
    } else {
      missing.push(f)
    }
  }

  return { removed, missing }
}

/**
 * Get plugin version from VERSION file
 * @param {object} config - needs installDir
 * @returns {string|null} version string or null
 */
export function readVersionFile(config) {
  const versionFile = resolve(config.installDir, './VERSION')
  try {
    return readFileSync(versionFile, 'utf8').trim()
  } catch {
    return null
  }
}
