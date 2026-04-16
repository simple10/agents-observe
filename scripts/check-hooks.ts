#!/usr/bin/env bun
/**
 * Checks that hook events and commands are consistent across our config files,
 * and ensures we don't register hooks that would cause unintended side effects.
 *
 * Uses .claude/settings.json as the authoritative source.
 *
 * Checks:
 * 1. All config files have the same hook events
 * 2. Commands match structurally (same script/args after normalizing path prefixes)
 * 3. All safe documented hooks from code.claude.com are present
 * 4. No blacklisted hooks are registered (hooks that replace default behavior)
 * 5. AI-assisted analysis of hook docs for additional exclusions
 *
 * Usage: bun scripts/check-hooks.ts [--skip-ai] [--output-prompt]
 */

import { readFileSync } from 'fs'
import { spawnSync } from 'child_process'

const HOOKS_DOC_URL = 'https://code.claude.com/docs/en/hooks.md'

const AUTHORITATIVE = '.claude/settings.json'
const TARGETS = ['hooks/hooks.json']

// Hooks that replace default Claude Code behavior and MUST NOT be registered
// by an observability plugin. Registering these delegates critical functionality
// to our hook, which we don't implement.
const BLACKLIST = new Set(['WorktreeCreate'])

// Path prefixes used in each file — stripped for comparison
const PATH_PREFIXES = [
  '$CLAUDE_PROJECT_DIR',
  '${CLAUDE_PLUGIN_ROOT}',
  '__HOOK_SCRIPT_DIR__',
  '__HOOK_SCRIPT__',
]

const SKIP_AI = process.argv.includes('--skip-ai')
const OUTPUT_PROMPT = process.argv.includes('--output-prompt')
const HELP = process.argv.includes('--help') || process.argv.includes('-h')

if (HELP) {
  console.log(`Usage: bun scripts/check-hooks.ts [options]

Checks that hook events and commands are consistent across our config files,
and ensures we don't register hooks that would cause unintended side effects.

Options:
  --skip-ai         Skip AI-assisted analysis of hook docs (faster, no claude CLI)
  --output-prompt   Print only the AI-analysis prompt (for piping to a file) and exit
  -h, --help        Show this help message and exit`)
  process.exit(0)
}

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

/** Build the prompt sent to the claude CLI for hook-safety analysis. */
function buildAiPrompt(hooksDocMd: string): string {
  return `You are analyzing Claude Code hook documentation for a plugin called "agents-observe" that is purely an observability/logging plugin. It should ONLY register hooks where it can safely observe events WITHOUT affecting Claude Code's behavior.

Analyze the hook documentation below and return a JSON object with a single key "exclude" containing an array of hook event names that this plugin should NOT register. A hook should be excluded if:
- It replaces default Claude Code behavior (e.g., the hook takes ownership of an action like creating a worktree)
- Registering it with a no-op response would cause Claude Code to fail or behave incorrectly
- The hook expects the handler to perform an action and return a result (not just observe)

Do NOT exclude hooks that are safe to register with exit 0 and no stdout (i.e., hooks where empty/no response means "allow" or "proceed normally").

Return ONLY the JSON object, no other text.

<hooks-documentation>
${hooksDocMd}
</hooks-documentation>`
}

/**
 * Ask Claude CLI to analyze the hooks documentation and identify hooks
 * that an observability-only plugin should NOT register.
 */
function aiAnalyzeHooks(hooksDocMd: string): string[] {
  const prompt = buildAiPrompt(hooksDocMd)

  try {
    const proc = spawnSync(
      'claude',
      ['-p', prompt, '--model', 'claude-opus-4-7', '--output-format', 'json', '--debug'],
      {
        encoding: 'utf8',
        timeout: 120_000,
      },
    )

    if (proc.error || proc.status !== 0) {
      throw new Error(proc.error?.message || proc.stderr || `exit ${proc.status}`)
    }

    const cliOutput = JSON.parse(proc.stdout)
    const text = cliOutput.result || ''

    // Extract JSON from Claude's response text (may be wrapped in markdown code blocks)
    const jsonMatch = text.match(/\{[\s\S]*"exclude"[\s\S]*\}/)
    if (!jsonMatch) {
      console.warn('  ⚠  AI analysis returned no parseable JSON')
      return []
    }

    const parsed = JSON.parse(jsonMatch[0])
    if (Array.isArray(parsed.exclude)) {
      return parsed.exclude
    }
    console.warn('  ⚠  AI analysis returned unexpected format')
    return []
  } catch (err) {
    console.warn(`  ⚠  AI analysis failed: ${err instanceof Error ? err.message : err}`)
    return []
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (OUTPUT_PROMPT) {
    const res = await fetch(HOOKS_DOC_URL)
    if (!res.ok) {
      console.error(`Failed to fetch hooks doc: HTTP ${res.status}`)
      process.exit(1)
    }
    const md = await res.text()
    process.stdout.write(buildAiPrompt(md))
    return
  }

  let hasErrors = false

  console.log('Checking claude hooks against:', HOOKS_DOC_URL)

  const authHooks = readHooks(AUTHORITATIVE)
  const authCommands = getEventCommands(authHooks)
  const authEvents = new Set(Object.keys(authHooks))

  console.log(`✓ ${AUTHORITATIVE} (${authEvents.size} events)`)

  // ------------------------------------------------------------------
  // Check: blacklisted hooks must not be registered
  // ------------------------------------------------------------------
  const blacklisted = [...authEvents].filter((e) => BLACKLIST.has(e))
  if (blacklisted.length > 0) {
    hasErrors = true
    console.error(`\n✗ Blacklisted hook(s) found in ${AUTHORITATIVE}: ${blacklisted.join(', ')}`)
    console.error(
      `  These hooks replace default Claude Code behavior and must not be registered by an observability plugin.`,
    )
  } else {
    console.log(`✓ No blacklisted hooks registered`)
  }

  // ------------------------------------------------------------------
  // Check: config file consistency
  // ------------------------------------------------------------------
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

    // Blacklist check on target too
    const targetBlacklisted = [...targetEvents].filter((e) => BLACKLIST.has(e))
    if (targetBlacklisted.length > 0) {
      hasErrors = true
      fileOk = false
      console.error(`✗ ${targetPath} — blacklisted hook(s): ${targetBlacklisted.join(', ')}`)
    }

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
      console.log(`✓ ${targetPath} — matches (${authEvents.size} events)`)
    }
  }

  // ------------------------------------------------------------------
  // Check: documented hooks coverage (excluding blacklisted)
  // ------------------------------------------------------------------
  const documented = await fetchDocumentedHooks()
  if (documented.length > 0) {
    const safeDocumented = documented.filter((h) => !BLACKLIST.has(h))
    const missing = safeDocumented.filter((h) => !authEvents.has(h))
    if (missing.length > 0) {
      hasErrors = true
      console.error(
        `\n✗ ${AUTHORITATIVE} is missing ${missing.length} documented hook(s): ${missing.join(
          ', ',
        )}`,
      )
    } else {
      console.log(
        `✓ All ${safeDocumented.length} safe documented hooks are present (${BLACKLIST.size} blacklisted)`,
      )
    }
  }

  // ------------------------------------------------------------------
  // AI analysis: cross-reference with Claude's understanding of the docs
  // ------------------------------------------------------------------
  if (!SKIP_AI && documented.length > 0) {
    console.log(`\n— AI analysis of hook safety (via claude CLI)...`)
    try {
      const res = await fetch(HOOKS_DOC_URL)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const md = await res.text()
      const aiExclusions = aiAnalyzeHooks(md)

      if (aiExclusions.length > 0) {
        console.log(`  AI recommends excluding: ${aiExclusions.join(', ')}`)

        // Check if AI found anything not in our blacklist
        const newExclusions = aiExclusions.filter((h) => !BLACKLIST.has(h))
        if (newExclusions.length > 0) {
          const registered = newExclusions.filter((h) => authEvents.has(h))
          if (registered.length > 0) {
            hasErrors = true
            console.error(
              `✗ AI flagged ${
                registered.length
              } registered hook(s) not in blacklist: ${registered.join(', ')}`,
            )
            console.error(`  Review these hooks and add to BLACKLIST if confirmed unsafe.`)
          } else {
            console.log(
              `  AI flagged ${newExclusions.length} hook(s) not in blacklist but none are registered`,
            )
          }
        }

        // Check if our blacklist has entries AI didn't flag (potential false positive in our list)
        const notFlaggedByAI = [...BLACKLIST].filter((h) => !aiExclusions.includes(h))
        if (notFlaggedByAI.length > 0) {
          console.warn(
            `  ⚠  Blacklist contains ${
              notFlaggedByAI.length
            } hook(s) AI did not flag: ${notFlaggedByAI.join(', ')}`,
          )
          console.warn(`  These may be safe — review and remove from blacklist if appropriate.`)
        }

        // Agreement
        const agreed = [...BLACKLIST].filter((h) => aiExclusions.includes(h))
        if (agreed.length > 0) {
          console.log(`  ✓ AI agrees with blacklist on: ${agreed.join(', ')}`)
        }
      } else {
        console.log(`  AI returned no exclusions`)
      }
    } catch (err) {
      console.warn(`  ⚠  AI analysis skipped: ${err instanceof Error ? err.message : err}`)
    }
  } else if (SKIP_AI) {
    console.log(`\n— AI analysis skipped (--skip-ai)`)
  }

  // ------------------------------------------------------------------
  // Summary
  // ------------------------------------------------------------------
  if (hasErrors) {
    console.error('\nHook configuration has issues. Fix them before releasing.')
    process.exit(1)
  }

  console.log('\nAll hook configurations are consistent and safe.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
