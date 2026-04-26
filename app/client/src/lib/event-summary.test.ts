import { describe, it, expect } from 'vitest'
import { getEventSummary } from './event-summary'
import type { ParsedEvent } from '@/types'

/** Translate legacy `subtype` / `toolName` overrides into the new wire
 *  shape: hookName + payload.tool_name. The unit-under-test
 *  (`getEventSummary`) derives those fields itself, so the public
 *  wire-shape stays minimal. */
function makeEvent(
  overrides: Partial<ParsedEvent> & {
    subtype?: string | null
    toolName?: string | null
    type?: string
    status?: string
  },
): ParsedEvent {
  const { subtype, toolName, type: _type, status: _status, ...rest } = overrides
  const hookName = rest.hookName ?? subtype ?? ''
  const basePayload =
    (rest.payload as Record<string, unknown> | undefined) ?? ({} as Record<string, unknown>)
  const payload =
    toolName && basePayload.tool_name === undefined
      ? { ...basePayload, tool_name: toolName }
      : basePayload
  const merged = {
    id: 1,
    agentId: 'agent-1',
    sessionId: 'sess-1',
    timestamp: Date.now(),
    createdAt: Date.now(),
    ...rest,
  } as ParsedEvent
  merged.hookName = hookName
  merged.payload = payload
  return merged
}

describe('getEventSummary', () => {
  // ── UserPromptSubmit ──────────────────────────────────────

  describe('UserPromptSubmit', () => {
    it('should return prompt text', () => {
      const event = makeEvent({
        subtype: 'UserPromptSubmit',
        payload: { prompt: 'Fix the bug in auth.ts' },
      })
      expect(getEventSummary(event)).toBe('Fix the bug in auth.ts')
    })

    it('should fall back to message.content', () => {
      const event = makeEvent({
        subtype: 'UserPromptSubmit',
        payload: { message: { content: 'Hello world' } },
      })
      expect(getEventSummary(event)).toBe('Hello world')
    })

    it('should strip markdown from prompt', () => {
      const event = makeEvent({
        subtype: 'UserPromptSubmit',
        payload: { prompt: '**Bold** and `code` text' },
      })
      expect(getEventSummary(event)).toBe('Bold and code text')
    })

    it('should collapse newlines', () => {
      const event = makeEvent({
        subtype: 'UserPromptSubmit',
        payload: { prompt: 'Line 1\nLine 2\nLine 3' },
      })
      expect(getEventSummary(event)).toBe('Line 1 Line 2 Line 3')
    })

    it('should strip list markers', () => {
      const event = makeEvent({
        subtype: 'UserPromptSubmit',
        payload: { prompt: '- Item 1\n* Item 2' },
      })
      expect(getEventSummary(event)).toBe('Item 1 Item 2')
    })

    it('should return empty string for missing prompt', () => {
      const event = makeEvent({
        subtype: 'UserPromptSubmit',
        payload: {},
      })
      expect(getEventSummary(event)).toBe('')
    })
  })

  // ── UserPromptExpansion ───────────────────────────────────

  describe('UserPromptExpansion', () => {
    it('should format slash-command as /command', () => {
      const event = makeEvent({
        subtype: 'UserPromptExpansion',
        payload: {
          expansion_type: 'slash_command',
          command_name: 'superpowers:writing-plans',
          command_args: '',
          prompt: '/superpowers:writing-plans',
        },
      })
      expect(getEventSummary(event)).toBe('/superpowers:writing-plans')
    })

    it('should include args when present', () => {
      const event = makeEvent({
        subtype: 'UserPromptExpansion',
        payload: { command_name: 'review', command_args: 'PR#42' },
      })
      expect(getEventSummary(event)).toBe('/review PR#42')
    })

    it('should fall back to prompt when command_name missing', () => {
      const event = makeEvent({
        subtype: 'UserPromptExpansion',
        payload: { prompt: 'some raw expanded text' },
      })
      expect(getEventSummary(event)).toBe('some raw expanded text')
    })

    it('should return empty string when nothing is present', () => {
      const event = makeEvent({ subtype: 'UserPromptExpansion', payload: {} })
      expect(getEventSummary(event)).toBe('')
    })
  })

  // ── SessionStart / SessionEnd ─────────────────────────────

  describe('SessionStart', () => {
    it('should include source when provided', () => {
      const event = makeEvent({
        subtype: 'SessionStart',
        payload: { source: 'cli' },
      })
      expect(getEventSummary(event)).toBe('Session cli')
    })

    it('should default to "New session" when no source', () => {
      const event = makeEvent({ subtype: 'SessionStart', payload: {} })
      expect(getEventSummary(event)).toBe('New session')
    })
  })

  describe('SessionEnd', () => {
    it('should return "Session ended"', () => {
      const event = makeEvent({ subtype: 'SessionEnd', payload: {} })
      expect(getEventSummary(event)).toBe('Session ended')
    })
  })

  // ── Stop ──────────────────────────────────────────────────

  describe('Stop', () => {
    it('should return final message when last_assistant_message exists', () => {
      const event = makeEvent({
        subtype: 'Stop',
        payload: { last_assistant_message: 'All done!' },
      })
      expect(getEventSummary(event)).toBe('Final: "All done!"')
    })

    it('should strip markdown from final message', () => {
      const event = makeEvent({
        subtype: 'Stop',
        payload: { last_assistant_message: '**Done** with `task`' },
      })
      expect(getEventSummary(event)).toBe('Final: "Done with task"')
    })

    it('should fall back to "Session stopped"', () => {
      const event = makeEvent({ subtype: 'Stop', payload: {} })
      expect(getEventSummary(event)).toBe('Session stopped')
    })
  })

  // ── StopFailure ───────────────────────────────────────────

  describe('StopFailure', () => {
    it('should show "Turn failed:" with last_assistant_message', () => {
      const event = makeEvent({
        subtype: 'StopFailure',
        payload: { last_assistant_message: 'Prompt is too long', error: 'invalid_request' },
      })
      expect(getEventSummary(event)).toBe('Turn failed: Prompt is too long')
    })

    it('should fall back to "Turn failed" when no message', () => {
      const event = makeEvent({ subtype: 'StopFailure', payload: { error: 'timeout' } })
      expect(getEventSummary(event)).toBe('Turn failed')
    })

    it('should fall back to "Turn failed" when empty payload', () => {
      const event = makeEvent({ subtype: 'StopFailure', payload: {} })
      expect(getEventSummary(event)).toBe('Turn failed')
    })
  })

  // ── SubagentStart / SubagentStop ──────────────────────────

  describe('SubagentStart', () => {
    it('should return agent_name', () => {
      const event = makeEvent({
        subtype: 'SubagentStart',
        payload: { agent_name: 'code-review' },
      })
      expect(getEventSummary(event)).toBe('code-review')
    })

    it('should fall back to description', () => {
      const event = makeEvent({
        subtype: 'SubagentStart',
        payload: { description: 'Review the PR' },
      })
      expect(getEventSummary(event)).toBe('Review the PR')
    })

    it('should fall back to default', () => {
      const event = makeEvent({ subtype: 'SubagentStart', payload: {} })
      expect(getEventSummary(event)).toBe('Subagent started')
    })
  })

  describe('SubagentStop', () => {
    it('should return agent_name', () => {
      const event = makeEvent({
        subtype: 'SubagentStop',
        payload: { agent_name: 'worker' },
      })
      expect(getEventSummary(event)).toBe('worker')
    })

    it('should fall back to default', () => {
      const event = makeEvent({ subtype: 'SubagentStop', payload: {} })
      expect(getEventSummary(event)).toBe('Subagent stopped')
    })
  })

  // ── Notification ──────────────────────────────────────────

  describe('Notification', () => {
    it('should return message', () => {
      const event = makeEvent({
        subtype: 'Notification',
        payload: { message: 'Build complete' },
      })
      expect(getEventSummary(event)).toBe('Build complete')
    })

    it('should fall back to title', () => {
      const event = makeEvent({
        subtype: 'Notification',
        payload: { title: 'Warning' },
      })
      expect(getEventSummary(event)).toBe('Warning')
    })
  })

  // ── PermissionRequest ─────────────────────────────────────

  describe('PermissionRequest', () => {
    it('should show tool_name with tool_input.description', () => {
      const event = makeEvent({
        subtype: 'PermissionRequest',
        payload: {
          tool_name: 'Bash',
          tool_input: { description: 'Test awk extraction for v0.8.0 changelog' },
        },
      })
      expect(getEventSummary(event)).toBe('Bash: Test awk extraction for v0.8.0 changelog')
    })

    it('should return tool_name when no description', () => {
      const event = makeEvent({
        subtype: 'PermissionRequest',
        payload: { tool_name: 'Bash' },
      })
      expect(getEventSummary(event)).toBe('Bash')
    })

    it('should fall back to default', () => {
      const event = makeEvent({ subtype: 'PermissionRequest', payload: {} })
      expect(getEventSummary(event)).toBe('Permission requested')
    })
  })

  // ── TaskCreated / TaskCompleted ───────────────────────────

  describe('TaskCreated', () => {
    it('should return description', () => {
      const event = makeEvent({
        subtype: 'TaskCreated',
        payload: { description: 'Implement auth flow' },
      })
      expect(getEventSummary(event)).toBe('Implement auth flow')
    })

    it('should fall back to task_description', () => {
      const event = makeEvent({
        subtype: 'TaskCreated',
        payload: { task_description: 'Write tests' },
      })
      expect(getEventSummary(event)).toBe('Write tests')
    })
  })

  describe('TaskCompleted', () => {
    it('should return description', () => {
      const event = makeEvent({
        subtype: 'TaskCompleted',
        payload: { description: 'Auth flow done' },
      })
      expect(getEventSummary(event)).toBe('Auth flow done')
    })

    it('should fall back to "Task done"', () => {
      const event = makeEvent({ subtype: 'TaskCompleted', payload: {} })
      expect(getEventSummary(event)).toBe('Task done')
    })
  })

  // ── Tool events (PreToolUse/PostToolUse) ──────────────────

  describe('PreToolUse/PostToolUse - Bash', () => {
    it('should prefer description over command', () => {
      const event = makeEvent({
        subtype: 'PreToolUse',
        toolName: 'Bash',
        payload: { tool_input: { description: 'List files', command: 'ls -la' } },
      })
      expect(getEventSummary(event)).toBe('[ls] List files')
    })

    it('should fall back to command', () => {
      const event = makeEvent({
        subtype: 'PreToolUse',
        toolName: 'Bash',
        payload: { tool_input: { command: 'npm test' } },
      })
      expect(getEventSummary(event)).toBe('[npm] npm test')
    })

    it('should collapse multi-line commands with \\n separators', () => {
      const event = makeEvent({
        subtype: 'PreToolUse',
        toolName: 'Bash',
        payload: {
          tool_input: {
            command: 'cat > /tmp/test.js << \'EOF\'\nconsole.log("hello")\nEOF\nnode /tmp/test.js',
          },
        },
      })
      expect(getEventSummary(event)).toBe(
        '[cat] cat > /tmp/test.js << \'EOF\' \\n console.log("hello") \\n EOF \\n node /tmp/test.js',
      )
    })

    it('should return empty for missing input', () => {
      const event = makeEvent({
        subtype: 'PreToolUse',
        toolName: 'Bash',
        payload: {},
      })
      expect(getEventSummary(event)).toBe('')
    })
  })

  describe('PreToolUse/PostToolUse - Read', () => {
    it('should show file path', () => {
      const event = makeEvent({
        subtype: 'PreToolUse',
        toolName: 'Read',
        payload: { tool_input: { file_path: '/home/user/src/index.ts' } },
      })
      expect(getEventSummary(event)).toBe('/home/user/src/index.ts')
    })

    it('should strip cwd prefix to show relative path', () => {
      const event = makeEvent({
        subtype: 'PreToolUse',
        toolName: 'Read',
        payload: {
          cwd: '/home/user/project',
          tool_input: { file_path: '/home/user/project/src/index.ts' },
        },
      })
      expect(getEventSummary(event)).toBe('src/index.ts')
    })
  })

  describe('PreToolUse/PostToolUse - Write', () => {
    it('should show relative file path', () => {
      const event = makeEvent({
        subtype: 'PostToolUse',
        toolName: 'Write',
        payload: {
          cwd: '/project',
          tool_input: { file_path: '/project/output.json' },
        },
      })
      expect(getEventSummary(event)).toBe('output.json')
    })
  })

  describe('PreToolUse/PostToolUse - Edit', () => {
    it('should show relative file path', () => {
      const event = makeEvent({
        subtype: 'PreToolUse',
        toolName: 'Edit',
        payload: {
          cwd: '/home/user/code',
          tool_input: {
            file_path: '/home/user/code/lib/utils.ts',
            old_string: 'const x = 1',
            new_string: 'const x = 2',
          },
        },
      })
      expect(getEventSummary(event)).toBe('lib/utils.ts')
    })

    it('should show absolute path when no cwd', () => {
      const event = makeEvent({
        subtype: 'PreToolUse',
        toolName: 'Edit',
        payload: {
          tool_input: { file_path: '/abs/path/file.ts' },
        },
      })
      expect(getEventSummary(event)).toBe('/abs/path/file.ts')
    })
  })

  describe('PreToolUse/PostToolUse - Grep', () => {
    it('should show pattern with path', () => {
      const event = makeEvent({
        subtype: 'PreToolUse',
        toolName: 'Grep',
        payload: {
          cwd: '/project',
          tool_input: { pattern: 'TODO', path: '/project/src' },
        },
      })
      expect(getEventSummary(event)).toBe('/TODO/ in src')
    })

    it('should show pattern only when no path', () => {
      const event = makeEvent({
        subtype: 'PreToolUse',
        toolName: 'Grep',
        payload: { tool_input: { pattern: 'error' } },
      })
      expect(getEventSummary(event)).toBe('/error/')
    })
  })

  describe('PreToolUse/PostToolUse - Glob', () => {
    it('should show glob pattern', () => {
      const event = makeEvent({
        subtype: 'PreToolUse',
        toolName: 'Glob',
        payload: { tool_input: { pattern: '**/*.ts' } },
      })
      expect(getEventSummary(event)).toBe('**/*.ts')
    })
  })

  describe('PreToolUse/PostToolUse - Agent', () => {
    it('should show description', () => {
      const event = makeEvent({
        subtype: 'PreToolUse',
        toolName: 'Agent',
        payload: { tool_input: { description: 'Review code changes' } },
      })
      expect(getEventSummary(event)).toBe('Review code changes')
    })

    it('should fall back to prompt', () => {
      const event = makeEvent({
        subtype: 'PreToolUse',
        toolName: 'Agent',
        payload: { tool_input: { prompt: 'Write unit tests' } },
      })
      expect(getEventSummary(event)).toBe('Write unit tests')
    })
  })

  describe('PreToolUse/PostToolUse - Skill', () => {
    it('should show skill name', () => {
      const event = makeEvent({
        subtype: 'PreToolUse',
        toolName: 'Skill',
        payload: { tool_input: { skill: 'commit' } },
      })
      expect(getEventSummary(event)).toBe('commit')
    })
  })

  describe('PreToolUse/PostToolUse - WebSearch/WebFetch', () => {
    it('should show query for WebSearch', () => {
      const event = makeEvent({
        subtype: 'PreToolUse',
        toolName: 'WebSearch',
        payload: { tool_input: { query: 'React 19 features' } },
      })
      expect(getEventSummary(event)).toBe('React 19 features')
    })

    it('should show URL for WebFetch', () => {
      const event = makeEvent({
        subtype: 'PreToolUse',
        toolName: 'WebFetch',
        payload: { tool_input: { url: 'https://example.com' } },
      })
      expect(getEventSummary(event)).toBe('https://example.com')
    })
  })

  describe('PreToolUse/PostToolUse - NotebookEdit', () => {
    it('should show relative notebook path', () => {
      const event = makeEvent({
        subtype: 'PreToolUse',
        toolName: 'NotebookEdit',
        payload: {
          cwd: '/project',
          tool_input: { notebook_path: '/project/analysis.ipynb' },
        },
      })
      expect(getEventSummary(event)).toBe('analysis.ipynb')
    })
  })

  describe('PreToolUse/PostToolUse - unknown tool (fallback)', () => {
    it('should use description from tool_input', () => {
      const event = makeEvent({
        subtype: 'PreToolUse',
        toolName: 'CustomTool',
        payload: { tool_input: { description: 'Do something' } },
      })
      expect(getEventSummary(event)).toBe('Do something')
    })

    it('should fall back to command', () => {
      const event = makeEvent({
        subtype: 'PreToolUse',
        toolName: 'CustomTool',
        payload: { tool_input: { command: 'run thing' } },
      })
      expect(getEventSummary(event)).toBe('run thing')
    })

    it('should fall back to query', () => {
      const event = makeEvent({
        subtype: 'PreToolUse',
        toolName: 'CustomTool',
        payload: { tool_input: { query: 'find something' } },
      })
      expect(getEventSummary(event)).toBe('find something')
    })
  })

  // ── PostToolUseFailure ────────────────────────────────────

  describe('PostToolUseFailure', () => {
    it('should show error message', () => {
      const event = makeEvent({
        subtype: 'PostToolUseFailure',
        toolName: 'Bash',
        payload: { error: 'Command not found' },
      })
      expect(getEventSummary(event)).toBe('Command not found')
    })

    it('should fall back to tool summary when no error', () => {
      const event = makeEvent({
        subtype: 'PostToolUseFailure',
        toolName: 'Bash',
        payload: { tool_input: { command: 'bad-cmd' } },
      })
      expect(getEventSummary(event)).toBe('[bad-cmd] bad-cmd')
    })

    it('should fall back to "Tool failed"', () => {
      const event = makeEvent({
        subtype: 'PostToolUseFailure',
        toolName: 'Bash',
        payload: {},
      })
      expect(getEventSummary(event)).toBe('Tool failed')
    })
  })

  // ── Other subtypes ────────────────────────────────────────

  describe('TeammateIdle', () => {
    it('should show teammate name', () => {
      const event = makeEvent({
        subtype: 'TeammateIdle',
        payload: { teammate_name: 'worker-1' },
      })
      expect(getEventSummary(event)).toBe('worker-1')
    })

    it('should fall back to default', () => {
      const event = makeEvent({ subtype: 'TeammateIdle', payload: {} })
      expect(getEventSummary(event)).toBe('Teammate idle')
    })
  })

  describe('InstructionsLoaded', () => {
    it('should show relative path', () => {
      const event = makeEvent({
        subtype: 'InstructionsLoaded',
        payload: { cwd: '/project', file_path: '/project/CLAUDE.md' },
      })
      expect(getEventSummary(event)).toBe('CLAUDE.md')
    })
  })

  describe('ConfigChange', () => {
    it('should show relative path', () => {
      const event = makeEvent({
        subtype: 'ConfigChange',
        payload: { cwd: '/project', file_path: '/project/.claude/settings.json' },
      })
      expect(getEventSummary(event)).toBe('.claude/settings.json')
    })

    it('should fall back to default', () => {
      const event = makeEvent({ subtype: 'ConfigChange', payload: {} })
      expect(getEventSummary(event)).toBe('Config changed')
    })
  })

  describe('CwdChanged', () => {
    it('should show new_cwd', () => {
      const event = makeEvent({
        subtype: 'CwdChanged',
        payload: { new_cwd: '/new/directory' },
      })
      expect(getEventSummary(event)).toBe('/new/directory')
    })

    it('should fall back to cwd', () => {
      const event = makeEvent({
        subtype: 'CwdChanged',
        payload: { cwd: '/current' },
      })
      expect(getEventSummary(event)).toBe('/current')
    })

    it('should fall back to default', () => {
      const event = makeEvent({ subtype: 'CwdChanged', payload: {} })
      expect(getEventSummary(event)).toBe('Directory changed')
    })
  })

  describe('FileChanged', () => {
    it('should show relative path', () => {
      const event = makeEvent({
        subtype: 'FileChanged',
        payload: { cwd: '/proj', file_path: '/proj/src/main.ts' },
      })
      expect(getEventSummary(event)).toBe('src/main.ts')
    })
  })

  describe('PreCompact / PostCompact', () => {
    it('should return "Compacting context..."', () => {
      const event = makeEvent({ subtype: 'PreCompact', payload: {} })
      expect(getEventSummary(event)).toBe('Compacting context...')
    })

    it('should return "Context compacted"', () => {
      const event = makeEvent({ subtype: 'PostCompact', payload: {} })
      expect(getEventSummary(event)).toBe('Context compacted')
    })
  })

  describe('Elicitation / ElicitationResult', () => {
    it('should show message for Elicitation', () => {
      const event = makeEvent({
        subtype: 'Elicitation',
        payload: { message: 'Enter your name' },
      })
      expect(getEventSummary(event)).toBe('Enter your name')
    })

    it('should fall back to question', () => {
      const event = makeEvent({
        subtype: 'Elicitation',
        payload: { question: 'What is the path?' },
      })
      expect(getEventSummary(event)).toBe('What is the path?')
    })

    it('should show response for ElicitationResult', () => {
      const event = makeEvent({
        subtype: 'ElicitationResult',
        payload: { response: 'John' },
      })
      expect(getEventSummary(event)).toBe('John')
    })

    it('should fall back to result', () => {
      const event = makeEvent({
        subtype: 'ElicitationResult',
        payload: { result: '/tmp/file.txt' },
      })
      expect(getEventSummary(event)).toBe('/tmp/file.txt')
    })

    it('should show defaults for empty payloads', () => {
      expect(getEventSummary(makeEvent({ subtype: 'Elicitation', payload: {} }))).toBe(
        'MCP input requested',
      )
      expect(getEventSummary(makeEvent({ subtype: 'ElicitationResult', payload: {} }))).toBe(
        'User responded',
      )
    })
  })

  describe('WorktreeCreate / WorktreeRemove', () => {
    it('should show branch for WorktreeCreate', () => {
      const event = makeEvent({
        subtype: 'WorktreeCreate',
        payload: { branch: 'feature/auth' },
      })
      expect(getEventSummary(event)).toBe('feature/auth')
    })

    it('should fall back to path', () => {
      const event = makeEvent({
        subtype: 'WorktreeCreate',
        payload: { path: '/worktrees/feature' },
      })
      expect(getEventSummary(event)).toBe('/worktrees/feature')
    })

    it('should show defaults for empty WorktreeCreate', () => {
      const event = makeEvent({ subtype: 'WorktreeCreate', payload: {} })
      expect(getEventSummary(event)).toBe('Worktree created')
    })

    it('should show branch for WorktreeRemove', () => {
      const event = makeEvent({
        subtype: 'WorktreeRemove',
        payload: { branch: 'old-branch' },
      })
      expect(getEventSummary(event)).toBe('old-branch')
    })

    it('should show default for empty WorktreeRemove', () => {
      const event = makeEvent({ subtype: 'WorktreeRemove', payload: {} })
      expect(getEventSummary(event)).toBe('Worktree removed')
    })
  })

  // ── Unknown subtypes ──────────────────────────────────────

  describe('unknown subtype', () => {
    it('should return empty string', () => {
      const event = makeEvent({ subtype: 'SomeFutureHook', payload: {} })
      expect(getEventSummary(event)).toBe('')
    })
  })

  // ── oneLine markdown stripping ────────────────────────────

  describe('oneLine markdown stripping', () => {
    it('should strip bold markers', () => {
      const event = makeEvent({
        subtype: 'UserPromptSubmit',
        payload: { prompt: '**Important** task' },
      })
      expect(getEventSummary(event)).toBe('Important task')
    })

    it('should strip inline code markers', () => {
      const event = makeEvent({
        subtype: 'UserPromptSubmit',
        payload: { prompt: 'Run `npm install`' },
      })
      expect(getEventSummary(event)).toBe('Run npm install')
    })

    it('should collapse multiple newlines and whitespace', () => {
      const event = makeEvent({
        subtype: 'UserPromptSubmit',
        payload: { prompt: 'First\n\n  Second\n   Third' },
      })
      expect(getEventSummary(event)).toBe('First Second Third')
    })

    it('should strip list markers at line starts', () => {
      const event = makeEvent({
        subtype: 'UserPromptSubmit',
        payload: { prompt: '- First\n* Second\n- Third' },
      })
      expect(getEventSummary(event)).toBe('First Second Third')
    })
  })

  // ── relativePath cwd prefix stripping ─────────────────────

  describe('relativePath cwd prefix stripping', () => {
    it('should strip cwd prefix from file paths', () => {
      const event = makeEvent({
        subtype: 'PreToolUse',
        toolName: 'Read',
        payload: {
          cwd: '/Users/joe/project',
          tool_input: { file_path: '/Users/joe/project/src/app.ts' },
        },
      })
      expect(getEventSummary(event)).toBe('src/app.ts')
    })

    it('should leave paths alone when cwd is not a prefix', () => {
      const event = makeEvent({
        subtype: 'PreToolUse',
        toolName: 'Read',
        payload: {
          cwd: '/different/path',
          tool_input: { file_path: '/Users/joe/project/file.ts' },
        },
      })
      expect(getEventSummary(event)).toBe('/Users/joe/project/file.ts')
    })

    it('should handle missing cwd gracefully', () => {
      const event = makeEvent({
        subtype: 'PreToolUse',
        toolName: 'Read',
        payload: {
          tool_input: { file_path: '/absolute/path/file.ts' },
        },
      })
      expect(getEventSummary(event)).toBe('/absolute/path/file.ts')
    })

    it('should handle missing file_path gracefully', () => {
      const event = makeEvent({
        subtype: 'PreToolUse',
        toolName: 'Read',
        payload: { tool_input: {} },
      })
      expect(getEventSummary(event)).toBe('')
    })
  })
})
