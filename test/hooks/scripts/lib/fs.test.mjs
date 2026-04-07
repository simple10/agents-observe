// test/hooks/scripts/lib/fs.test.mjs
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  validatePath,
  ensureLocalDataDirs,
  resolvePluginDataDir,
  readServerPortFile,
  saveServerPortFile,
  removeServerPortFile,
  removeDatabase,
  readVersionFile,
} from '../../../../hooks/scripts/lib/fs.mjs'

let testDir

beforeEach(() => {
  testDir = join(tmpdir(), `fs-test-${Date.now()}`)
  mkdirSync(testDir, { recursive: true })
})

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('validatePath', () => {
  it('throws on empty string', () => {
    expect(() => validatePath('')).toThrow('empty or undefined')
  })

  it('throws on whitespace-only string', () => {
    expect(() => validatePath('   ')).toThrow('empty or undefined')
  })

  it('throws on null/undefined', () => {
    expect(() => validatePath(null)).toThrow('empty or undefined')
    expect(() => validatePath(undefined)).toThrow('empty or undefined')
  })

  it('includes label in error message', () => {
    expect(() => validatePath('', 'dataDir')).toThrow('dataDir is empty or undefined')
  })

  it('throws on null bytes', () => {
    expect(() => validatePath('/some/path\0evil')).toThrow('null bytes')
  })

  it('throws on HTTP URLs', () => {
    expect(() => validatePath('http://example.com')).toThrow('URL or flag')
    expect(() => validatePath('https://example.com')).toThrow('URL or flag')
  })

  it('throws on CLI flags', () => {
    expect(() => validatePath('--some-flag')).toThrow('URL or flag')
  })

  it('throws when path resolves to filesystem root', () => {
    expect(() => validatePath('/')).toThrow('filesystem root')
  })

  it('resolves valid absolute paths', () => {
    expect(validatePath('/tmp/test')).toBe('/tmp/test')
  })

  it('resolves relative paths to absolute', () => {
    const result = validatePath('relative/path')
    expect(result).toContain('relative/path')
    expect(result.startsWith('/')).toBe(true)
  })

  it('allows paths with spaces', () => {
    expect(validatePath('/tmp/my dir/data')).toBe('/tmp/my dir/data')
  })

  it('allows dot-prefixed paths', () => {
    expect(validatePath('/home/user/.agents-observe')).toBe('/home/user/.agents-observe')
  })
})

describe('ensureLocalDataDirs', () => {
  it('creates localDataRootDir, dataDir, and logsDir', () => {
    const config = {
      localDataRootDir: join(testDir, 'root'),
      dataDir: join(testDir, 'root/data'),
      logsDir: join(testDir, 'root/logs'),
    }
    ensureLocalDataDirs(config)
    expect(existsSync(config.localDataRootDir)).toBe(true)
    expect(existsSync(config.dataDir)).toBe(true)
    expect(existsSync(config.logsDir)).toBe(true)
  })

  it('is idempotent — calling twice does not error', () => {
    const config = {
      localDataRootDir: join(testDir, 'root'),
      dataDir: join(testDir, 'root/data'),
      logsDir: join(testDir, 'root/logs'),
    }
    ensureLocalDataDirs(config)
    ensureLocalDataDirs(config)
    expect(existsSync(config.localDataRootDir)).toBe(true)
  })

  it('creates nested directories', () => {
    const config = {
      localDataRootDir: join(testDir, 'a/b/c'),
      dataDir: join(testDir, 'a/b/c/data'),
      logsDir: join(testDir, 'a/b/c/logs'),
    }
    ensureLocalDataDirs(config)
    expect(existsSync(config.dataDir)).toBe(true)
  })

  it('throws when localDataRootDir is empty', () => {
    const config = {
      localDataRootDir: '',
      dataDir: join(testDir, 'data'),
      logsDir: join(testDir, 'logs'),
    }
    expect(() => ensureLocalDataDirs(config)).toThrow('localDataRootDir')
  })

  it('throws when dataDir is empty', () => {
    const config = {
      localDataRootDir: join(testDir, 'root'),
      dataDir: '',
      logsDir: join(testDir, 'logs'),
    }
    expect(() => ensureLocalDataDirs(config)).toThrow('dataDir')
  })

  it('throws when logsDir is empty', () => {
    const config = {
      localDataRootDir: join(testDir, 'root'),
      dataDir: join(testDir, 'data'),
      logsDir: '',
    }
    expect(() => ensureLocalDataDirs(config)).toThrow('logsDir')
  })

  it('throws when any path resolves to root', () => {
    const config = {
      localDataRootDir: '/',
      dataDir: join(testDir, 'data'),
      logsDir: join(testDir, 'logs'),
    }
    expect(() => ensureLocalDataDirs(config)).toThrow('filesystem root')
  })

  it('does not create any dirs if validation fails', () => {
    const config = {
      localDataRootDir: join(testDir, 'shouldnt-exist'),
      dataDir: '',
      logsDir: join(testDir, 'logs'),
    }
    expect(() => ensureLocalDataDirs(config)).toThrow()
    // localDataRootDir should NOT have been created since validation runs first
    expect(existsSync(join(testDir, 'shouldnt-exist'))).toBe(false)
  })
})

describe('resolvePluginDataDir', () => {
  it('returns pluginDataDir when it contains the plugin name', () => {
    const config = {
      pluginDataDir: '/home/user/.claude/plugins/data/agents-observe',
      pluginName: 'agents-observe',
      homeDir: '/home/user',
      serverPortFileName: 'server-port',
    }
    expect(resolvePluginDataDir(config)).toBe('/home/user/.claude/plugins/data/agents-observe')
  })

  it('returns null when pluginDataDir points to wrong plugin and no port file exists', () => {
    const config = {
      pluginDataDir: '/home/user/.claude/plugins/data/some-other-plugin',
      pluginName: 'agents-observe',
      homeDir: testDir,
      serverPortFileName: 'server-port',
    }
    expect(resolvePluginDataDir(config)).toBeNull()
  })

  it('returns null when pluginDataDir is undefined and no port file exists', () => {
    const config = {
      pluginDataDir: undefined,
      pluginName: 'agents-observe',
      homeDir: testDir,
      serverPortFileName: 'server-port',
    }
    expect(resolvePluginDataDir(config)).toBeNull()
  })

  it('returns null when homeDir is empty', () => {
    const config = {
      pluginDataDir: undefined,
      pluginName: 'agents-observe',
      homeDir: '',
      serverPortFileName: 'server-port',
    }
    expect(resolvePluginDataDir(config)).toBeNull()
  })

  it('discovers inline plugin dir via server-port file', () => {
    const inlineDir = join(testDir, '.claude/plugins/data/agents-observe-inline')
    mkdirSync(inlineDir, { recursive: true })
    writeFileSync(join(inlineDir, 'server-port'), '4981')

    const config = {
      pluginDataDir: '/wrong/plugin',
      pluginName: 'agents-observe',
      homeDir: testDir,
      serverPortFileName: 'server-port',
    }
    expect(resolvePluginDataDir(config)).toBe(inlineDir)
  })

  it('discovers bare plugin dir via server-port file', () => {
    const bareDir = join(testDir, '.claude/plugins/data/agents-observe')
    mkdirSync(bareDir, { recursive: true })
    writeFileSync(join(bareDir, 'server-port'), '4981')

    const config = {
      pluginDataDir: '/wrong/plugin',
      pluginName: 'agents-observe',
      homeDir: testDir,
      serverPortFileName: 'server-port',
    }
    expect(resolvePluginDataDir(config)).toBe(bareDir)
  })

  it('prefers inline dir over bare dir when both exist', () => {
    const inlineDir = join(testDir, '.claude/plugins/data/agents-observe-inline')
    const bareDir = join(testDir, '.claude/plugins/data/agents-observe')
    mkdirSync(inlineDir, { recursive: true })
    mkdirSync(bareDir, { recursive: true })
    writeFileSync(join(inlineDir, 'server-port'), '4981')
    writeFileSync(join(bareDir, 'server-port'), '4982')

    const config = {
      pluginDataDir: '/wrong/plugin',
      pluginName: 'agents-observe',
      homeDir: testDir,
      serverPortFileName: 'server-port',
    }
    expect(resolvePluginDataDir(config)).toBe(inlineDir)
  })
})

describe('readServerPortFile', () => {
  it('reads port from file', () => {
    const portFile = join(testDir, 'server-port')
    writeFileSync(portFile, '4981')
    expect(readServerPortFile({ serverPortFile: portFile })).toBe('4981')
  })

  it('trims whitespace from port', () => {
    const portFile = join(testDir, 'server-port')
    writeFileSync(portFile, '  4981\n')
    expect(readServerPortFile({ serverPortFile: portFile })).toBe('4981')
  })

  it('returns null when file does not exist', () => {
    expect(readServerPortFile({ serverPortFile: join(testDir, 'nonexistent') })).toBeNull()
  })

  it('returns null when file is empty', () => {
    const portFile = join(testDir, 'server-port')
    writeFileSync(portFile, '')
    expect(readServerPortFile({ serverPortFile: portFile })).toBeNull()
  })
})

describe('saveServerPortFile', () => {
  it('writes port to file', () => {
    const portFile = join(testDir, 'server-port')
    saveServerPortFile({ serverPortFile: portFile }, 4981)
    expect(readFileSync(portFile, 'utf8')).toBe('4981')
  })

  it('converts port number to string', () => {
    const portFile = join(testDir, 'server-port')
    saveServerPortFile({ serverPortFile: portFile }, 9999)
    expect(readFileSync(portFile, 'utf8')).toBe('9999')
  })

  it('overwrites existing port file', () => {
    const portFile = join(testDir, 'server-port')
    writeFileSync(portFile, '1111')
    saveServerPortFile({ serverPortFile: portFile }, 2222)
    expect(readFileSync(portFile, 'utf8')).toBe('2222')
  })
})

describe('removeServerPortFile', () => {
  it('removes existing port file', () => {
    const portFile = join(testDir, 'server-port')
    writeFileSync(portFile, '4981')
    removeServerPortFile({ serverPortFile: portFile })
    expect(existsSync(portFile)).toBe(false)
  })

  it('does not throw when file does not exist', () => {
    expect(() =>
      removeServerPortFile({ serverPortFile: join(testDir, 'nonexistent') }),
    ).not.toThrow()
  })
})

describe('readVersionFile', () => {
  it('reads version from VERSION file at installDir root', () => {
    writeFileSync(join(testDir, 'VERSION'), '0.8.0')
    expect(readVersionFile({ installDir: testDir })).toBe('0.8.0')
  })

  it('trims whitespace from version', () => {
    writeFileSync(join(testDir, 'VERSION'), '  0.8.0\n')
    expect(readVersionFile({ installDir: testDir })).toBe('0.8.0')
  })

  it('returns null when VERSION file does not exist', () => {
    expect(readVersionFile({ installDir: join(testDir, 'nonexistent') })).toBeNull()
  })
})

describe('removeDatabase', () => {
  it('removes db and journal files', () => {
    const dataDir = join(testDir, 'data')
    const databaseFileName = 'observe.db'
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(join(dataDir, databaseFileName), 'data')
    writeFileSync(join(dataDir, `${databaseFileName}-wal`), 'wal')
    writeFileSync(join(dataDir, `${databaseFileName}-shm`), 'shm')

    const { removed, missing } = removeDatabase({ dataDir, databaseFileName })
    expect(removed).toHaveLength(3)
    expect(removed[0]).toContain('observe.db')
    expect(missing).toHaveLength(1) // -journal doesn't exist
    expect(existsSync(join(dataDir, 'observe.db'))).toBe(false)
    expect(existsSync(join(dataDir, 'observe.db-wal'))).toBe(false)
    expect(existsSync(join(dataDir, 'observe.db-shm'))).toBe(false)
  })

  it('reports all files as missing when no db exists', () => {
    const dataDir = join(testDir, 'empty')
    mkdirSync(dataDir, { recursive: true })

    const { removed, missing } = removeDatabase({ dataDir, databaseFileName: 'observe.db' })
    expect(removed).toHaveLength(0)
    expect(missing).toHaveLength(4)
  })

  it('handles partial files (only db, no journals)', () => {
    const dataDir = join(testDir, 'data')
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(join(dataDir, 'observe.db'), 'data')

    const { removed, missing } = removeDatabase({ dataDir, databaseFileName: 'observe.db' })
    expect(removed).toHaveLength(1)
    expect(removed[0]).toContain('observe.db')
    expect(missing).toHaveLength(3)
  })

  it('does not touch other files in the data dir', () => {
    const dataDir = join(testDir, 'data')
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(join(dataDir, 'observe.db'), 'data')
    writeFileSync(join(dataDir, 'other-file.txt'), 'keep me')

    removeDatabase({ dataDir, databaseFileName: 'observe.db' })
    expect(existsSync(join(dataDir, 'other-file.txt'))).toBe(true)
  })
})
