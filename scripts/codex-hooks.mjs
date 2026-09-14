#!/usr/bin/env node

import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
  codexHooksStatus,
  installCodexHooks,
  uninstallCodexHooks,
} from '../hooks/scripts/lib/codex-hooks.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const hookScriptPath = resolve(scriptDir, '../hooks/scripts/hook.sh')
const { command, codexHome } = parseArgs(process.argv.slice(2))

try {
  if (command === 'install') {
    const result = await installCodexHooks({ codexHome, hookScriptPath })
    console.log(`Installed Agents Observe hooks in ${result.hooksPath}`)
    console.log('Open /hooks in Codex and trust the new command definitions before using them.')
  } else if (command === 'uninstall') {
    const result = await uninstallCodexHooks({ codexHome })
    console.log(`Removed Agents Observe hooks from ${result.hooksPath}`)
  } else if (command === 'status') {
    const result = await codexHooksStatus({ codexHome, hookScriptPath })
    console.log(`Codex hooks file: ${result.hooksPath}`)
    console.log(`Agents Observe: ${result.installed ? 'installed' : 'not fully installed'}`)
    console.log(`Configured events: ${result.configuredEvents.join(', ') || 'none'}`)
    if (result.stalePath) {
      console.log('Installed hook commands reference a different checkout path; rerun install.')
    }
    if (result.missingEvents.length > 0) {
      console.log(`Missing or stale events: ${result.missingEvents.join(', ')}`)
      process.exitCode = 1
    }
  } else {
    printHelp()
    process.exitCode = command ? 1 : 0
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}

function printHelp() {
  console.log('Usage: node scripts/codex-hooks.mjs <install|status|uninstall> [--codex-home PATH]')
  console.log('')
  console.log('Installs user-level Agents Observe hooks in ~/.codex/hooks.json.')
  console.log('Existing non-Agents-Observe hooks are preserved.')
}

function parseArgs(args) {
  let command = null
  let codexHome = null
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--codex-home' && args[i + 1]) {
      codexHome = args[++i]
    } else if (!args[i].startsWith('-') && !command) {
      command = args[i]
    }
  }
  return { command, codexHome }
}
