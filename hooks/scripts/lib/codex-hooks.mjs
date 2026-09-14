import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'

export const AGENTS_OBSERVE_HOOK_MARKER = 'AGENTS_OBSERVE_HOOK_SOURCE=global'

export const AGENTS_OBSERVE_CODEX_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Stop',
]

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`
}

function commandForEvent(eventName, hookScriptPath) {
  const env = ['AGENTS_OBSERVE_AGENT_CLASS=codex', AGENTS_OBSERVE_HOOK_MARKER]
  if (eventName === 'Stop') env.push('AGENTS_OBSERVE_NOTIFICATION_ON_EVENTS=Stop')
  return `${env.join(' ')} bash ${shellQuote(resolve(hookScriptPath))}`
}

function groupForEvent(eventName, hookScriptPath) {
  const group = {
    hooks: [
      {
        type: 'command',
        command: commandForEvent(eventName, hookScriptPath),
      },
    ],
  }
  if (eventName === 'SessionStart') {
    group.matcher = ''
    group.hooks[0].statusMessage = 'Starting Agents Observe'
  } else if (eventName === 'PreToolUse' || eventName === 'PostToolUse') {
    group.matcher = ''
  }
  return group
}

export function isAgentsObserveHook(handler) {
  if (!handler || typeof handler !== 'object' || typeof handler.command !== 'string') {
    return false
  }
  return (
    handler.command.includes(AGENTS_OBSERVE_HOOK_MARKER) ||
    (handler.command.includes('AGENTS_OBSERVE_AGENT_CLASS=codex') &&
      handler.command.includes('hooks/scripts/hook.sh'))
  )
}

export function removeAgentsObserveHooks(document = {}) {
  const next = structuredClone(document && typeof document === 'object' ? document : {})
  const hooks =
    next.hooks && typeof next.hooks === 'object' && !Array.isArray(next.hooks) ? next.hooks : {}

  for (const [eventName, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue
    const retainedGroups = []
    for (const group of groups) {
      if (!group || typeof group !== 'object') {
        retainedGroups.push(group)
        continue
      }
      const handlers = Array.isArray(group.hooks) ? group.hooks : []
      const retainedHandlers = handlers.filter((handler) => !isAgentsObserveHook(handler))
      if (retainedHandlers.length > 0 || handlers.length === 0) {
        retainedGroups.push({ ...group, hooks: retainedHandlers })
      }
    }
    if (retainedGroups.length > 0) hooks[eventName] = retainedGroups
    else delete hooks[eventName]
  }

  next.hooks = hooks
  return next
}

export function mergeAgentsObserveHooks(document = {}, hookScriptPath) {
  if (!hookScriptPath) throw new Error('hookScriptPath is required')
  const next = removeAgentsObserveHooks(document)
  if (!next.hooks || typeof next.hooks !== 'object') next.hooks = {}

  for (const eventName of AGENTS_OBSERVE_CODEX_EVENTS) {
    const groups = Array.isArray(next.hooks[eventName]) ? next.hooks[eventName] : []
    next.hooks[eventName] = [...groups, groupForEvent(eventName, hookScriptPath)]
  }
  return next
}

export function getAgentsObserveHookStatus(document = {}, hookScriptPath = null) {
  const configured = new Set()
  const current = new Set()
  const hooks =
    document?.hooks && typeof document.hooks === 'object' && !Array.isArray(document.hooks)
      ? document.hooks
      : {}
  for (const [eventName, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue
    const handlers = groups.flatMap((group) => (Array.isArray(group?.hooks) ? group.hooks : []))
    if (handlers.some((handler) => isAgentsObserveHook(handler))) configured.add(eventName)
    if (
      hookScriptPath &&
      handlers.some((handler) => handler?.command === commandForEvent(eventName, hookScriptPath))
    ) {
      current.add(eventName)
    }
  }
  const effective = hookScriptPath ? current : configured
  return {
    installed: AGENTS_OBSERVE_CODEX_EVENTS.every((eventName) => effective.has(eventName)),
    configuredEvents: [...configured].sort(),
    currentEvents: [...current].sort(),
    missingEvents: AGENTS_OBSERVE_CODEX_EVENTS.filter((eventName) => !effective.has(eventName)),
    stalePath: Boolean(hookScriptPath && configured.size > 0 && current.size < configured.size),
  }
}

export function resolveCodexHome(explicitHome = null) {
  return resolve(explicitHome || join(homedir(), '.codex'))
}

export function resolveCodexHooksPath(explicitHome = null) {
  return join(resolveCodexHome(explicitHome), 'hooks.json')
}

export async function readCodexHooks(hooksPath) {
  try {
    const raw = await readFile(hooksPath, 'utf8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('top-level value must be a JSON object')
    }
    return parsed
  } catch (error) {
    if (error?.code === 'ENOENT') return {}
    if (error instanceof SyntaxError) {
      throw new Error(`Cannot parse ${hooksPath}: ${error.message}`)
    }
    throw error
  }
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true })
  const tempPath = `${path}.agents-observe.${process.pid}.tmp`
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await rename(tempPath, path)
}

export async function installCodexHooks({ codexHome = null, hookScriptPath } = {}) {
  if (!hookScriptPath) throw new Error('hookScriptPath is required')
  const hooksPath = resolveCodexHooksPath(codexHome)
  const current = await readCodexHooks(hooksPath)
  const next = mergeAgentsObserveHooks(current, hookScriptPath)
  await writeJsonAtomic(hooksPath, next)
  return { hooksPath, ...getAgentsObserveHookStatus(next) }
}

export async function uninstallCodexHooks({ codexHome = null } = {}) {
  const hooksPath = resolveCodexHooksPath(codexHome)
  const current = await readCodexHooks(hooksPath)
  const next = removeAgentsObserveHooks(current)
  await writeJsonAtomic(hooksPath, next)
  return { hooksPath, ...getAgentsObserveHookStatus(next) }
}

export async function codexHooksStatus({ codexHome = null, hookScriptPath = null } = {}) {
  const hooksPath = resolveCodexHooksPath(codexHome)
  const current = await readCodexHooks(hooksPath)
  return { hooksPath, ...getAgentsObserveHookStatus(current, hookScriptPath) }
}
