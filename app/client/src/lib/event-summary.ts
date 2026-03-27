// Client-side summary generation from event payload.
// NO truncation — the UI handles that via CSS.

import type { ParsedEvent } from '@/types';

export function getEventSummary(event: ParsedEvent): string {
  const p = event.payload as Record<string, any>;
  const cwd = p.cwd as string | undefined;

  switch (event.subtype) {
    case 'UserPromptSubmit':
      return oneLine(p.prompt || p.message?.content || '');

    case 'SessionStart':
      return p.source ? `Session ${p.source}` : 'New session';

    case 'SessionEnd':
      return 'Session ended';

    case 'Stop':
      return getStopSummary(event);

    case 'StopFailure':
      return p.error_type ? `Error: ${p.error_type}` : 'Turn failed';

    case 'SubagentStart':
      return p.agent_name || p.description || 'Subagent started';

    case 'SubagentStop':
      return p.agent_name || 'Subagent stopped';

    case 'Notification':
      return oneLine(p.message || p.title || '');

    case 'PreToolUse':
    case 'PostToolUse':
      return getToolSummary(event.toolName, p.tool_input, cwd);

    case 'PostToolUseFailure':
      return oneLine(p.error || getToolSummary(event.toolName, p.tool_input, cwd) || 'Tool failed');

    case 'PermissionRequest':
      return p.tool_name ? `${p.tool_name}` : 'Permission requested';

    case 'TaskCreated':
      return oneLine(p.description || p.task_description || '');

    case 'TaskCompleted':
      return oneLine(p.description || p.task_description || 'Task done');

    case 'TeammateIdle':
      return p.teammate_name || 'Teammate idle';

    case 'InstructionsLoaded':
      return p.file_path ? relativePath(p.file_path, cwd) : 'Instructions loaded';

    case 'ConfigChange':
      return p.file_path ? relativePath(p.file_path, cwd) : 'Config changed';

    case 'CwdChanged':
      return p.new_cwd || p.cwd || 'Directory changed';

    case 'FileChanged':
      return p.file_path ? relativePath(p.file_path, cwd) : 'File changed';

    case 'PreCompact':
      return 'Compacting context...';

    case 'PostCompact':
      return 'Context compacted';

    case 'Elicitation':
      return oneLine(p.message || p.question || 'MCP input requested');

    case 'ElicitationResult':
      return oneLine(p.response || p.result || 'User responded');

    case 'WorktreeCreate':
      return p.branch || p.path || 'Worktree created';

    case 'WorktreeRemove':
      return p.branch || p.path || 'Worktree removed';

    default:
      return '';
  }
}

function getToolSummary(
  toolName: string | null,
  toolInput: Record<string, any> | undefined,
  cwd: string | undefined
): string {
  if (!toolInput) return '';

  switch (toolName) {
    case 'Bash': {
      const desc = toolInput.description;
      const cmd = toolInput.command;
      // Prefer description over raw command (more readable)
      return desc || cmd || '';
    }
    case 'Read':
    case 'Write':
      return relativePath(toolInput.file_path, cwd);
    case 'Edit': {
      const fp = relativePath(toolInput.file_path, cwd);
      // Show what was changed if available
      const oldStr = toolInput.old_string as string | undefined;
      if (fp && oldStr) return `${fp}`;
      return fp;
    }
    case 'Grep': {
      const pattern = toolInput.pattern;
      const path = toolInput.path;
      const rp = path ? relativePath(path, cwd) : '';
      if (pattern && rp) return `/${pattern}/ in ${rp}`;
      if (pattern) return `/${pattern}/`;
      return '';
    }
    case 'Glob':
      return toolInput.pattern || '';
    case 'Agent':
      return toolInput.description || toolInput.prompt || '';
    case 'Skill':
      return toolInput.skill || '';
    case 'WebSearch':
    case 'WebFetch':
      return toolInput.query || toolInput.url || '';
    case 'NotebookEdit':
      return relativePath(toolInput.notebook_path, cwd);
    default:
      return toolInput.description || toolInput.command || toolInput.query || '';
  }
}

function getStopSummary(event: ParsedEvent): string {
  const p = event.payload as Record<string, any>;
  const lastMsg = p.last_assistant_message as string | undefined;

  if (lastMsg) return `Final: "${oneLine(lastMsg)}"`;
  return 'Session stopped';
}

// Collapse newlines/whitespace into a single line, strip markdown
function oneLine(s: string): string {
  return s
    .replace(/\*\*(.*?)\*\*/g, '$1')   // **bold** → bold
    .replace(/`([^`]+)`/g, '$1')        // `code` → code
    .replace(/^[-*] /gm, '')            // strip list markers
    .replace(/\s*\n\s*/g, ' ')
    .trim();
}

// Strip cwd prefix to show relative paths
function relativePath(fp: string | undefined, cwd: string | undefined): string {
  if (!fp) return '';
  if (cwd && fp.startsWith(cwd)) {
    const rel = fp.slice(cwd.length);
    // Remove leading slash
    return rel.startsWith('/') ? rel.slice(1) : rel;
  }
  return fp;
}
