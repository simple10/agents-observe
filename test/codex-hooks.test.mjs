import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  AGENTS_OBSERVE_CODEX_EVENTS,
  codexHooksStatus,
  getAgentsObserveHookStatus,
  installCodexHooks,
  mergeAgentsObserveHooks,
  removeAgentsObserveHooks,
  uninstallCodexHooks,
} from '../hooks/scripts/lib/codex-hooks.mjs'

const tempDirs = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempCodexHome() {
  const dir = await mkdtemp(join(tmpdir(), 'agents-observe-codex-hooks-'))
  tempDirs.push(dir)
  return dir
}

describe('Codex global hook installation', () => {
  it('preserves unrelated hooks and is idempotent', () => {
    const original = {
      description: 'user hooks',
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'echo existing' }] }],
      },
    }

    const first = mergeAgentsObserveHooks(original, '/opt/agents observe/hooks/scripts/hook.sh')
    const second = mergeAgentsObserveHooks(first, '/opt/agents observe/hooks/scripts/hook.sh')

    expect(second).toEqual(first)
    expect(second.description).toBe('user hooks')
    expect(second.hooks.Stop[0].hooks[0].command).toBe('echo existing')
    expect(second.hooks.Stop).toHaveLength(2)
    expect(JSON.stringify(second)).toContain("bash '/opt/agents observe/hooks/scripts/hook.sh'")
  })

  it('replaces legacy manually copied Agents Observe handlers', () => {
    const legacy = {
      hooks: {
        Stop: [
          {
            hooks: [
              {
                type: 'command',
                command:
                  'AGENTS_OBSERVE_AGENT_CLASS=codex bash "/old/agents-observe/hooks/scripts/hook.sh"',
              },
            ],
          },
        ],
      },
    }

    const installed = mergeAgentsObserveHooks(legacy, '/new/agents-observe/hooks/scripts/hook.sh')
    expect(installed.hooks.Stop).toHaveLength(1)
    expect(JSON.stringify(installed)).not.toContain('/old/agents-observe')
  })

  it('detects hook definitions pointing at a moved checkout', () => {
    const installed = mergeAgentsObserveHooks({}, '/old/agents-observe/hooks/scripts/hook.sh')
    const status = getAgentsObserveHookStatus(
      installed,
      '/new/agents-observe/hooks/scripts/hook.sh',
    )
    expect(status.installed).toBe(false)
    expect(status.stalePath).toBe(true)
  })

  it('removes only Agents Observe handlers', () => {
    const installed = mergeAgentsObserveHooks(
      {
        hooks: {
          PreToolUse: [
            {
              matcher: '',
              hooks: [{ type: 'command', command: 'echo keep-me' }],
            },
          ],
        },
      },
      '/opt/agents-observe/hooks/scripts/hook.sh',
    )

    const removed = removeAgentsObserveHooks(installed)

    expect(removed.hooks.PreToolUse).toEqual([
      { matcher: '', hooks: [{ type: 'command', command: 'echo keep-me' }] },
    ])
    for (const eventName of AGENTS_OBSERVE_CODEX_EVENTS.filter((name) => name !== 'PreToolUse')) {
      expect(removed.hooks[eventName]).toBeUndefined()
    }
  })

  it('installs, reports status, and uninstalls on disk', async () => {
    const codexHome = await tempCodexHome()
    const hooksPath = join(codexHome, 'hooks.json')
    await writeFile(
      hooksPath,
      JSON.stringify({ hooks: { SessionEnd: [{ hooks: [{ type: 'command', command: 'echo bye' }] }] } }),
    )

    const installed = await installCodexHooks({
      codexHome,
      hookScriptPath: '/opt/agents-observe/hooks/scripts/hook.sh',
    })
    expect(installed.installed).toBe(true)

    const status = await codexHooksStatus({
      codexHome,
      hookScriptPath: '/opt/agents-observe/hooks/scripts/hook.sh',
    })
    expect(status.configuredEvents.sort()).toEqual([...AGENTS_OBSERVE_CODEX_EVENTS].sort())

    const uninstalled = await uninstallCodexHooks({ codexHome })
    expect(uninstalled.installed).toBe(false)

    const finalDocument = JSON.parse(await readFile(hooksPath, 'utf8'))
    expect(finalDocument.hooks.SessionEnd[0].hooks[0].command).toBe('echo bye')
  })

  it('refuses to overwrite malformed JSON', async () => {
    const codexHome = await tempCodexHome()
    const hooksPath = join(codexHome, 'hooks.json')
    await writeFile(hooksPath, '{broken')

    await expect(
      installCodexHooks({
        codexHome,
        hookScriptPath: '/opt/agents-observe/hooks/scripts/hook.sh',
      }),
    ).rejects.toThrow(`Cannot parse ${hooksPath}`)

    expect(await readFile(hooksPath, 'utf8')).toBe('{broken')
  })
})
