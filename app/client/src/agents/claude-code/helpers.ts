// Claude Code agent class — summary generation and utility helpers.

import type { RawEvent } from '../types'

/** Extract the binary/command name from a bash command string. */
// Valid binary name: alphanumeric, hyphens, dots, underscores — no shell special chars
const VALID_BINARY_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

export function extractBashBinary(cmd: string): string | null {
  const first = cmd.split('\n')[0].trim()
  const tokens = first.split(/\s+/)
  let skipNext = false
  for (const token of tokens) {
    if (skipNext) {
      skipNext = false
      continue
    }
    // Skip env vars (FOO=bar), shell operators, subshell markers
    if (token.includes('=') || token === '&&' || token === ';' || token === '||') continue
    if (token.startsWith('$(') || token.startsWith('`')) continue
    if (token === 'cd') {
      skipNext = true
      continue
    }
    // Skip shell keywords that aren't binaries
    if (
      token === 'for' ||
      token === 'do' ||
      token === 'done' ||
      token === 'if' ||
      token === 'then' ||
      token === 'else' ||
      token === 'fi' ||
      token === 'while' ||
      token === 'case' ||
      token === 'esac'
    )
      continue
    const bin = token.replace(/^.*\//, '')
    // Validate: must look like a real binary name
    if (bin && VALID_BINARY_RE.test(bin)) return bin
  }
  return null
}

/** Strip cwd prefix to show relative paths. */
export function relativePath(fp: string | undefined, cwd: string | undefined): string {
  if (!fp) return ''
  if (cwd && fp.startsWith(cwd)) {
    const rel = fp.slice(cwd.length)
    return rel.startsWith('/') ? rel.slice(1) : rel
  }
  return fp
}

/** Collapse newlines/whitespace into a single line, strip markdown. */
export function oneLine(s: string): string {
  return s
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^[-*] /gm, '')
    .replace(/\s*\n\s*/g, ' ')
    .trim()
}

/** Generate one-line summary text from a raw event. Takes derived
 *  subtype/toolName as arguments — those fields are no longer on the
 *  wire `RawEvent`. */
export function getEventSummary(
  event: RawEvent,
  subtype: string | null,
  toolName: string | null,
): string {
  const p = event.payload as Record<string, any>
  const cwd = (event.cwd ?? (p.cwd as string | undefined)) as string | undefined

  switch (subtype) {
    case 'UserPromptSubmit':
      return oneLine(p.prompt || p.message?.content || '')
    case 'UserPromptExpansion': {
      const name = p.command_name as string | undefined
      const args = p.command_args as string | undefined
      if (name) return args ? `/${name} ${oneLine(args)}` : `/${name}`
      return oneLine(p.prompt || '')
    }
    case 'SessionStart':
      return p.source ? `Session ${p.source}` : 'New session'
    case 'SessionEnd':
      return 'Session ended'
    case 'Stop': {
      const lastMsg = p.last_assistant_message as string | undefined
      return lastMsg ? `Final: "${oneLine(lastMsg)}"` : 'Session stopped'
    }
    case 'StopFailure': {
      const msg = p.last_assistant_message as string | undefined
      return msg ? `Turn failed: ${oneLine(msg)}` : 'Turn failed'
    }
    case 'SubagentStart':
      return p.agent_name || p.description || 'Subagent started'
    case 'SubagentStop':
      return p.agent_name || 'Subagent stopped'
    case 'Notification':
      return oneLine(p.message || p.title || '')
    case 'PreToolUse':
    case 'PostToolUse':
      return getToolSummary(toolName, p.tool_input, cwd)
    case 'PostToolUseFailure':
      return oneLine(p.error || getToolSummary(toolName, p.tool_input, cwd) || 'Tool failed')
    case 'PermissionRequest': {
      const tool = p.tool_name as string | undefined
      const desc = p.tool_input?.description as string | undefined
      if (tool && desc) return `${tool}: ${oneLine(desc)}`
      if (tool) return tool
      return 'Permission requested'
    }
    case 'TaskCreated':
      return oneLine(p.task_subject || p.description || p.task_description || '')
    case 'TaskCompleted':
      return oneLine(p.task_subject || p.description || p.task_description || 'Task done')
    case 'TeammateIdle':
      return p.teammate_name || 'Teammate idle'
    case 'InstructionsLoaded':
      return p.file_path ? relativePath(p.file_path, cwd) : 'Instructions loaded'
    case 'ConfigChange':
      return p.file_path ? relativePath(p.file_path, cwd) : 'Config changed'
    case 'CwdChanged':
      return p.new_cwd || p.cwd || 'Directory changed'
    case 'FileChanged':
      return p.file_path ? relativePath(p.file_path, cwd) : 'File changed'
    case 'PreCompact':
      return 'Compacting context...'
    case 'PostCompact':
      return 'Context compacted'
    case 'Elicitation':
      return oneLine(p.message || p.question || 'MCP input requested')
    case 'ElicitationResult':
      return oneLine(p.response || p.result || 'User responded')
    case 'WorktreeCreate':
      return p.branch || p.path || 'Worktree created'
    case 'WorktreeRemove':
      return p.branch || p.path || 'Worktree removed'
    default:
      return ''
  }
}

function getToolSummary(
  toolName: string | null,
  toolInput: Record<string, any> | undefined,
  cwd: string | undefined,
): string {
  if (!toolInput) return ''
  switch (toolName) {
    case 'Bash': {
      const desc = toolInput.description as string | undefined
      const cmd = toolInput.command as string | undefined
      const bin = cmd ? extractBashBinary(cmd) : null
      const binPrefix = bin ? `[${bin}] ` : ''
      if (desc) return `${binPrefix}${desc}`
      return cmd ? `${binPrefix}${cmd.replace(/\s*\n\s*/g, ' \\n ').trim()}` : ''
    }
    case 'Read':
    case 'Write':
      return relativePath(toolInput.file_path, cwd)
    case 'Edit': {
      const fp = relativePath(toolInput.file_path, cwd)
      const oldStr = toolInput.old_string as string | undefined
      if (fp && oldStr) return `${fp}`
      return fp
    }
    case 'Grep': {
      const pattern = toolInput.pattern
      const path = toolInput.path
      const rp = path ? relativePath(path, cwd) : ''
      if (pattern && rp) return `/${pattern}/ in ${rp}`
      if (pattern) return `/${pattern}/`
      return ''
    }
    case 'Glob':
      return toolInput.pattern || ''
    case 'Agent':
      return toolInput.description || toolInput.prompt || ''
    case 'Skill':
      return toolInput.skill || ''
    case 'WebSearch':
    case 'WebFetch':
      return toolInput.query || toolInput.url || ''
    case 'NotebookEdit':
      return relativePath(toolInput.notebook_path, cwd)
    default:
      return toolInput.description || toolInput.command || toolInput.query || ''
  }
}

/** Build pre-computed searchText from an event and its summary. Derived
 *  fields (subtype/toolName/type) are passed in since the wire event no
 *  longer carries them. */
export function buildSearchText(
  event: RawEvent,
  summary: string,
  subtype: string | null,
  toolName: string | null,
  type: string | null,
): string {
  const parts: string[] = [summary]
  if (toolName) parts.push(toolName)
  if (subtype) parts.push(subtype)
  if (type) parts.push(type)

  const p = event.payload as Record<string, any>
  // Include key payload fields for search
  if (p.tool_input?.command) parts.push(p.tool_input.command)
  if (p.tool_input?.file_path) parts.push(p.tool_input.file_path)
  if (p.tool_input?.pattern) parts.push(p.tool_input.pattern)
  if (p.tool_input?.description) parts.push(p.tool_input.description)
  if (p.prompt) parts.push(p.prompt)
  if (p.error) parts.push(p.error)

  return parts.filter(Boolean).join(' ').toLowerCase()
}
