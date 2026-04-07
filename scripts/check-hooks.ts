#!/usr/bin/env bun
/**
 * Checks that hook events and commands are consistent across our three config files.
 * Uses .claude/settings.json as the authoritative source.
 *
 * Checks:
 * 1. All three files have the same hook events
 * 2. Commands match structurally (same script/args after normalizing path prefixes)
 * 3. All documented hooks from code.claude.com are present
 *
 * Usage: bun scripts/check-hooks.ts
 */

import { readFileSync } from 'fs'

const HOOKS_DOC_URL = 'https://code.claude.com/docs/en/hooks.md'

const AUTHORITATIVE = '.claude/settings.json'
const TARGETS = ['hooks/hooks.json']

// Path prefixes used in each file — stripped for comparison
const PATH_PREFIXES = [
  '$CLAUDE_PROJECT_DIR',
  '${CLAUDE_PLUGIN_ROOT}',
  '__HOOK_SCRIPT_DIR__',
  '__HOOK_SCRIPT__',
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface HookEntry {
  type: string
  command: string
}

interface HookConfig {
  [event: string]: { matcher?: string; hooks: HookEntry[] }[]
}

function readHooks(path: string): HookConfig {
  const json = JSON.parse(readFileSync(path, 'utf8'))
  return json.hooks ?? {}
}

/** Normalize a command by stripping known path prefixes */
function normalizeCommand(cmd: string): string {
  let normalized = cmd
  for (const prefix of PATH_PREFIXES) {
    normalized = normalized.replace(prefix, '<ROOT>')
  }
  return normalized.trim()
}

/** Extract normalized commands for each event */
function getEventCommands(hooks: HookConfig): Map<string, string[]> {
  const result = new Map<string, string[]>()
  for (const [event, matchers] of Object.entries(hooks)) {
    const commands = matchers.flatMap((m) =>
      (m.hooks || []).map((h: HookEntry) => normalizeCommand(h.command)),
    )
    result.set(event, commands)
  }
  return result
}

async function fetchDocumentedHooks(): Promise<string[]> {
  try {
    const res = await fetch(HOOKS_DOC_URL)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const md = await res.text()
    const hooks = new Set<string>()
    for (const line of md.split('\n')) {
      const match = line.match(/^\|\s*`([A-Z][A-Za-z]+)`\s*\|/)
      if (match) hooks.add(match[1])
    }
    if (hooks.size === 0) throw new Error('No hooks parsed')
    return [...hooks]
  } catch (err) {
    console.warn(`  ⚠  Could not fetch documented hooks: ${err}`)
    return []
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  let hasErrors = false

  const authHooks = readHooks(AUTHORITATIVE)
  const authCommands = getEventCommands(authHooks)
  const authEvents = new Set(Object.keys(authHooks))

  console.log(`Authority: ${AUTHORITATIVE} (${authEvents.size} events)`)

  for (const targetPath of TARGETS) {
    let targetHooks: HookConfig
    try {
      targetHooks = readHooks(targetPath)
    } catch {
      console.error(`✗ ${targetPath} — file not found or unreadable`)
      hasErrors = true
      continue
    }

    const targetEvents = new Set(Object.keys(targetHooks))
    const targetCommands = getEventCommands(targetHooks)
    let fileOk = true

    // Missing events
    const missing = [...authEvents].filter((e) => !targetEvents.has(e))
    if (missing.length > 0) {
      hasErrors = true
      fileOk = false
      console.error(`✗ ${targetPath} — missing ${missing.length} event(s): ${missing.join(', ')}`)
    }

    // Extra events
    const extra = [...targetEvents].filter((e) => !authEvents.has(e))
    if (extra.length > 0) {
      hasErrors = true
      fileOk = false
      console.error(`✗ ${targetPath} — extra ${extra.length} event(s): ${extra.join(', ')}`)
    }

    // Command structure matches
    for (const event of authEvents) {
      if (!targetEvents.has(event)) continue
      const authCmds = authCommands.get(event) ?? []
      const targetCmds = targetCommands.get(event) ?? []

      if (authCmds.length !== targetCmds.length) {
        hasErrors = true
        fileOk = false
        console.error(
          `✗ ${targetPath} — ${event}: ${targetCmds.length} command(s) vs ${authCmds.length} in authority`,
        )
        continue
      }

      for (let i = 0; i < authCmds.length; i++) {
        if (authCmds[i] !== targetCmds[i]) {
          hasErrors = true
          fileOk = false
          console.error(`✗ ${targetPath} — ${event} command mismatch:`)
          console.error(`    authority: ${authCmds[i]}`)
          console.error(`    target:    ${targetCmds[i]}`)
        }
      }
    }

    if (fileOk) {
      console.log(`✓ ${targetPath} — matches authority`)
    }
  }

  // Check against documented hooks
  const documented = await fetchDocumentedHooks()
  if (documented.length > 0) {
    const missing = documented.filter((h) => !authEvents.has(h))
    if (missing.length > 0) {
      hasErrors = true
      console.error(
        `\n✗ ${AUTHORITATIVE} is missing ${missing.length} documented hook(s): ${missing.join(', ')}`,
      )
    } else {
      console.log(`\n✓ All ${documented.length} documented hooks are present`)
    }
  }

  if (hasErrors) {
    console.error('\nHook configuration has issues. Fix them before releasing.')
    process.exit(1)
  }

  console.log('\nAll hook configurations are consistent.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
