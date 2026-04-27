// Claude Code agent class — icon and color mapping for event types.
// Moved from config/event-icons.ts

import { lazy } from 'react'
import type { LucideIcon } from 'lucide-react'
import dynamicIconImports from 'lucide-react/dynamicIconImports'
import { resolveIconName } from '@/lib/dynamic-icon'
import {
  Rocket,
  Flag,
  CircleStop,
  Bomb,
  MessageSquare,
  MessageSquareReply,
  SquareSlash,
  Wrench,
  Zap,
  BookOpen,
  Pencil,
  FilePen,
  Bot,
  Search,
  SearchCode,
  Globe,
  CircleCheck,
  CircleX,
  Moon,
  ClipboardList,
  Lock,
  Bell,
  FileText,
  Settings,
  FolderOpen,
  Minimize,
  CircleHelp,
  GitBranch,
  Trash,
  Hourglass,
  User,
  Pin,
  Plug,
} from 'lucide-react'
import { getIconCustomization, COLOR_PRESETS } from '@/hooks/use-icon-customizations'

const lazyIconCache = new Map<string, LucideIcon>()

export const eventIcons: Record<string, LucideIcon> = {
  SessionStart: Rocket,
  SessionEnd: Flag,
  Stop: CircleStop,
  StopFailure: Bomb,
  UserPromptSubmit: MessageSquare,
  UserPromptSubmitResponse: MessageSquareReply,
  UserPromptExpansion: SquareSlash,
  Bash: Zap,
  Read: BookOpen,
  Write: Pencil,
  Edit: FilePen,
  Agent: Bot,
  Glob: Search,
  Grep: SearchCode,
  WebSearch: Globe,
  WebFetch: Globe,
  _ToolDefault: Wrench,
  _ToolSuccess: CircleCheck,
  _ToolFailure: CircleX,
  _MCP: Plug,
  SubagentStart: Bot,
  SubagentStop: Bot,
  TeammateIdle: Moon,
  TaskCreated: ClipboardList,
  TaskCompleted: CircleCheck,
  PermissionRequest: Lock,
  Notification: Bell,
  InstructionsLoaded: FileText,
  ConfigChange: Settings,
  CwdChanged: FolderOpen,
  FileChanged: FilePen,
  PreCompact: Minimize,
  PostCompact: Minimize,
  Elicitation: CircleHelp,
  ElicitationResult: MessageSquare,
  WorktreeCreate: GitBranch,
  WorktreeRemove: Trash,
  progress: Hourglass,
  agent_progress: Bot,
  system: Settings,
  stop_hook_summary: CircleStop,
  user: User,
  assistant: Bot,
}

export const defaultEventIcon: LucideIcon = Pin

export const eventColors: Record<string, [string, string]> = {
  SessionStart: ['text-yellow-600 dark:text-yellow-400', 'bg-yellow-600 dark:bg-yellow-500'],
  SessionEnd: ['text-yellow-600 dark:text-yellow-400', 'bg-yellow-600 dark:bg-yellow-500'],
  Stop: ['text-yellow-600 dark:text-yellow-400', 'bg-yellow-600 dark:bg-yellow-500'],
  StopFailure: ['text-red-600 dark:text-red-400', 'bg-red-600 dark:bg-red-500'],
  stop_hook_summary: ['text-yellow-600 dark:text-yellow-400', 'bg-yellow-600 dark:bg-yellow-500'],
  UserPromptSubmit: ['text-green-600 dark:text-green-400', 'bg-green-600 dark:bg-green-500'],
  UserPromptSubmitResponse: [
    'text-green-600 dark:text-green-400',
    'bg-green-600 dark:bg-green-500',
  ],
  UserPromptExpansion: ['text-green-600 dark:text-green-400', 'bg-green-600 dark:bg-green-500'],
  user: ['text-green-600 dark:text-green-400', 'bg-green-600 dark:bg-green-500'],
  Bash: ['text-blue-600 dark:text-blue-400', 'bg-blue-600 dark:bg-blue-500'],
  Read: ['text-blue-600 dark:text-blue-400', 'bg-blue-600 dark:bg-blue-500'],
  Write: ['text-blue-600 dark:text-blue-400', 'bg-blue-600 dark:bg-blue-500'],
  Edit: ['text-blue-600 dark:text-blue-400', 'bg-blue-600 dark:bg-blue-500'],
  Glob: ['text-blue-600 dark:text-blue-400', 'bg-blue-600 dark:bg-blue-500'],
  Grep: ['text-blue-600 dark:text-blue-400', 'bg-blue-600 dark:bg-blue-500'],
  WebSearch: ['text-blue-600 dark:text-blue-400', 'bg-blue-600 dark:bg-blue-500'],
  WebFetch: ['text-blue-600 dark:text-blue-400', 'bg-blue-600 dark:bg-blue-500'],
  _ToolDefault: ['text-blue-600 dark:text-blue-400', 'bg-blue-600 dark:bg-blue-500'],
  _ToolSuccess: ['text-blue-600 dark:text-blue-400', 'bg-blue-600 dark:bg-blue-500'],
  _ToolFailure: ['text-red-600 dark:text-red-400', 'bg-red-600 dark:bg-red-500'],
  _MCP: ['text-cyan-600 dark:text-cyan-400', 'bg-cyan-600 dark:bg-cyan-500'],
  Agent: ['text-purple-600 dark:text-purple-400', 'bg-purple-600 dark:bg-purple-500'],
  SubagentStart: ['text-purple-600 dark:text-purple-400', 'bg-purple-600 dark:bg-purple-500'],
  SubagentStop: ['text-purple-600 dark:text-purple-400', 'bg-purple-600 dark:bg-purple-500'],
  TeammateIdle: ['text-purple-600 dark:text-purple-400', 'bg-purple-600 dark:bg-purple-500'],
  assistant: ['text-purple-600 dark:text-purple-400', 'bg-purple-600 dark:bg-purple-500'],
  agent_progress: ['text-purple-600 dark:text-purple-400', 'bg-purple-600 dark:bg-purple-500'],
  TaskCreated: ['text-cyan-600 dark:text-cyan-400', 'bg-cyan-600 dark:bg-cyan-500'],
  TaskCompleted: ['text-cyan-600 dark:text-cyan-400', 'bg-cyan-600 dark:bg-cyan-500'],
  PermissionRequest: ['text-rose-600 dark:text-rose-400', 'bg-rose-600 dark:bg-rose-500'],
  Notification: ['text-sky-600 dark:text-sky-400', 'bg-sky-600 dark:bg-sky-500'],
  InstructionsLoaded: ['text-slate-600 dark:text-slate-400', 'bg-slate-600 dark:bg-slate-500'],
  ConfigChange: ['text-slate-600 dark:text-slate-400', 'bg-slate-600 dark:bg-slate-500'],
  CwdChanged: ['text-slate-600 dark:text-slate-400', 'bg-slate-600 dark:bg-slate-500'],
  FileChanged: ['text-slate-600 dark:text-slate-400', 'bg-slate-600 dark:bg-slate-500'],
  system: ['text-slate-600 dark:text-slate-400', 'bg-slate-600 dark:bg-slate-500'],
  PreCompact: ['text-gray-500 dark:text-gray-400', 'bg-gray-500 dark:bg-gray-400'],
  PostCompact: ['text-gray-500 dark:text-gray-400', 'bg-gray-500 dark:bg-gray-400'],
  Elicitation: ['text-indigo-600 dark:text-indigo-400', 'bg-indigo-600 dark:bg-indigo-500'],
  ElicitationResult: ['text-indigo-600 dark:text-indigo-400', 'bg-indigo-600 dark:bg-indigo-500'],
  WorktreeCreate: ['text-teal-600 dark:text-teal-400', 'bg-teal-600 dark:bg-teal-500'],
  WorktreeRemove: ['text-teal-600 dark:text-teal-400', 'bg-teal-600 dark:bg-teal-500'],
  progress: ['text-amber-600 dark:text-amber-400', 'bg-amber-600 dark:bg-amber-500'],
}

const defaultEventColor: [string, string] = [
  'text-muted-foreground',
  'bg-muted-foreground dark:bg-muted-foreground',
]

export function resolveEventKey(hookName: string | null, toolName?: string | null): string {
  const isTool =
    hookName === 'PreToolUse' || hookName === 'PostToolUse' || hookName === 'PostToolUseFailure'
  if (isTool && toolName) {
    // MCP tools resolve to _MCP for icon/color (individual tools can be customized)
    if (toolName.startsWith('mcp__')) return '_MCP'
    return toolName
  }
  return hookName || 'unknown'
}

function toolFallbackKey(hookName: string | null): string {
  if (hookName === 'PostToolUseFailure') return '_ToolFailure'
  if (hookName === 'PostToolUse') return '_ToolSuccess'
  return '_ToolDefault'
}

export function getEventColor(
  hookName: string | null,
  toolName?: string | null,
): { iconColor: string; dotColor: string; customHex?: string } {
  const key = resolveEventKey(hookName, toolName)
  const isTool =
    hookName === 'PreToolUse' || hookName === 'PostToolUse' || hookName === 'PostToolUseFailure'

  const custom = getIconCustomization(key)
  if (custom?.colorName === 'custom' && custom.customHex) {
    return { iconColor: '', dotColor: '', customHex: custom.customHex }
  }
  if (custom?.colorName && COLOR_PRESETS[custom.colorName]) {
    const preset = COLOR_PRESETS[custom.colorName]
    return { iconColor: preset.iconColor, dotColor: preset.dotColor }
  }

  let color = eventColors[key]
  if (!color && isTool) color = eventColors[toolFallbackKey(hookName)]
  const [iconColor, dotColor] = color || defaultEventColor
  return { iconColor, dotColor }
}

export function getEventIcon(hookName: string | null, toolName?: string | null): LucideIcon {
  const key = resolveEventKey(hookName, toolName)
  const isTool =
    hookName === 'PreToolUse' || hookName === 'PostToolUse' || hookName === 'PostToolUseFailure'

  const custom = getIconCustomization(key)
  if (custom?.iconName) {
    const resolved = resolveIconName(custom.iconName)
    if (resolved) {
      if (!lazyIconCache.has(resolved)) {
        lazyIconCache.set(resolved, lazy(dynamicIconImports[resolved]) as unknown as LucideIcon)
      }
      return lazyIconCache.get(resolved)!
    }
  }

  if (eventIcons[key]) return eventIcons[key]
  if (isTool) return eventIcons[toolFallbackKey(hookName)] || defaultEventIcon
  return defaultEventIcon
}
