import type { LucideIcon } from 'lucide-react'
import {
  Rocket,
  Flag,
  CircleStop,
  Bomb,
  MessageSquare,
  MessageSquareReply,
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
} from 'lucide-react'
import { icons as allLucideIcons } from 'lucide-react'
import { getIconCustomization, COLOR_PRESETS } from '@/hooks/use-icon-customizations'

export const eventIcons: Record<string, LucideIcon> = {
  // Session lifecycle
  SessionStart: Rocket,
  SessionEnd: Flag,
  Stop: CircleStop,
  StopFailure: Bomb,

  // User input
  UserPromptSubmit: MessageSquare,
  UserPromptSubmitResponse: MessageSquareReply,

  // Tool use
  PreToolUse: Wrench,
  'PreToolUse:Bash': Zap,
  'PreToolUse:Read': BookOpen,
  'PreToolUse:Write': Pencil,
  'PreToolUse:Edit': FilePen,
  'PreToolUse:Agent': Bot,
  'PreToolUse:Glob': Search,
  'PreToolUse:Grep': SearchCode,
  'PreToolUse:WebSearch': Globe,
  'PreToolUse:WebFetch': Globe,
  PostToolUse: CircleCheck,
  'PostToolUse:Bash': Zap,
  'PostToolUse:Agent': Bot,
  PostToolUseFailure: CircleX,

  // Agents & teams
  SubagentStart: Bot,
  SubagentStop: Bot,
  TeammateIdle: Moon,

  // Tasks
  TaskCreated: ClipboardList,
  TaskCompleted: CircleCheck,

  // Permissions
  PermissionRequest: Lock,

  // Notifications
  Notification: Bell,

  // Config & files
  InstructionsLoaded: FileText,
  ConfigChange: Settings,
  CwdChanged: FolderOpen,
  FileChanged: FilePen,

  // Compaction
  PreCompact: Minimize,
  PostCompact: Minimize,

  // MCP
  Elicitation: CircleHelp,
  ElicitationResult: MessageSquare,

  // Worktrees
  WorktreeCreate: GitBranch,
  WorktreeRemove: Trash,

  // Legacy / transcript format
  progress: Hourglass,
  agent_progress: Bot,
  system: Settings,
  stop_hook_summary: CircleStop,
  user: User,
  assistant: Bot,
}

export const defaultEventIcon: LucideIcon = Pin

// Color classes for event icons: [stream icon color, solid bg for timeline dots]
// Using semantic colors to group related event types
const eventColors: Record<string, [string, string]> = {
  // Session lifecycle — yellow
  SessionStart: ['text-yellow-600 dark:text-yellow-400', 'bg-yellow-600 dark:bg-yellow-500'],
  SessionEnd: ['text-yellow-600 dark:text-yellow-400', 'bg-yellow-600 dark:bg-yellow-500'],
  Stop: ['text-yellow-600 dark:text-yellow-400', 'bg-yellow-600 dark:bg-yellow-500'],
  StopFailure: ['text-red-600 dark:text-red-400', 'bg-red-600 dark:bg-red-500'],
  stop_hook_summary: ['text-yellow-600 dark:text-yellow-400', 'bg-yellow-600 dark:bg-yellow-500'],

  // User input — green
  UserPromptSubmit: ['text-green-600 dark:text-green-400', 'bg-green-600 dark:bg-green-500'],
  UserPromptSubmitResponse: ['text-green-600 dark:text-green-400', 'bg-green-600 dark:bg-green-500'],
  user: ['text-green-600 dark:text-green-400', 'bg-green-600 dark:bg-green-500'],

  // Tool use — blue
  PreToolUse: ['text-blue-600 dark:text-blue-400', 'bg-blue-600 dark:bg-blue-500'],
  'PreToolUse:Bash': ['text-blue-600 dark:text-blue-400', 'bg-blue-600 dark:bg-blue-500'],
  'PreToolUse:Read': ['text-blue-600 dark:text-blue-400', 'bg-blue-600 dark:bg-blue-500'],
  'PreToolUse:Write': ['text-blue-600 dark:text-blue-400', 'bg-blue-600 dark:bg-blue-500'],
  'PreToolUse:Edit': ['text-blue-600 dark:text-blue-400', 'bg-blue-600 dark:bg-blue-500'],
  'PreToolUse:Glob': ['text-blue-600 dark:text-blue-400', 'bg-blue-600 dark:bg-blue-500'],
  'PreToolUse:Grep': ['text-blue-600 dark:text-blue-400', 'bg-blue-600 dark:bg-blue-500'],
  'PreToolUse:WebSearch': ['text-blue-600 dark:text-blue-400', 'bg-blue-600 dark:bg-blue-500'],
  'PreToolUse:WebFetch': ['text-blue-600 dark:text-blue-400', 'bg-blue-600 dark:bg-blue-500'],
  PostToolUse: ['text-blue-600 dark:text-blue-400', 'bg-blue-600 dark:bg-blue-500'],
  'PostToolUse:Bash': ['text-blue-600 dark:text-blue-400', 'bg-blue-600 dark:bg-blue-500'],
  PostToolUseFailure: ['text-red-600 dark:text-red-400', 'bg-red-600 dark:bg-red-500'],

  // Agents — purple
  'PreToolUse:Agent': ['text-purple-600 dark:text-purple-400', 'bg-purple-600 dark:bg-purple-500'],
  'PostToolUse:Agent': ['text-purple-600 dark:text-purple-400', 'bg-purple-600 dark:bg-purple-500'],
  SubagentStart: ['text-purple-600 dark:text-purple-400', 'bg-purple-600 dark:bg-purple-500'],
  SubagentStop: ['text-purple-600 dark:text-purple-400', 'bg-purple-600 dark:bg-purple-500'],
  TeammateIdle: ['text-purple-600 dark:text-purple-400', 'bg-purple-600 dark:bg-purple-500'],
  assistant: ['text-purple-600 dark:text-purple-400', 'bg-purple-600 dark:bg-purple-500'],
  agent_progress: ['text-purple-600 dark:text-purple-400', 'bg-purple-600 dark:bg-purple-500'],

  // Tasks — cyan
  TaskCreated: ['text-cyan-600 dark:text-cyan-400', 'bg-cyan-600 dark:bg-cyan-500'],
  TaskCompleted: ['text-cyan-600 dark:text-cyan-400', 'bg-cyan-600 dark:bg-cyan-500'],

  // Permissions — rose
  PermissionRequest: ['text-rose-600 dark:text-rose-400', 'bg-rose-600 dark:bg-rose-500'],

  // Notifications — sky
  Notification: ['text-sky-600 dark:text-sky-400', 'bg-sky-600 dark:bg-sky-500'],

  // Config & files — slate/gray
  InstructionsLoaded: ['text-slate-600 dark:text-slate-400', 'bg-slate-600 dark:bg-slate-500'],
  ConfigChange: ['text-slate-600 dark:text-slate-400', 'bg-slate-600 dark:bg-slate-500'],
  CwdChanged: ['text-slate-600 dark:text-slate-400', 'bg-slate-600 dark:bg-slate-500'],
  FileChanged: ['text-slate-600 dark:text-slate-400', 'bg-slate-600 dark:bg-slate-500'],
  system: ['text-slate-600 dark:text-slate-400', 'bg-slate-600 dark:bg-slate-500'],

  // Compaction — gray
  PreCompact: ['text-gray-500 dark:text-gray-400', 'bg-gray-500 dark:bg-gray-400'],
  PostCompact: ['text-gray-500 dark:text-gray-400', 'bg-gray-500 dark:bg-gray-400'],

  // MCP — indigo
  Elicitation: ['text-indigo-600 dark:text-indigo-400', 'bg-indigo-600 dark:bg-indigo-500'],
  ElicitationResult: ['text-indigo-600 dark:text-indigo-400', 'bg-indigo-600 dark:bg-indigo-500'],

  // Worktrees — teal
  WorktreeCreate: ['text-teal-600 dark:text-teal-400', 'bg-teal-600 dark:bg-teal-500'],
  WorktreeRemove: ['text-teal-600 dark:text-teal-400', 'bg-teal-600 dark:bg-teal-500'],

  // Progress — amber
  progress: ['text-amber-600 dark:text-amber-400', 'bg-amber-600 dark:bg-amber-500'],
}

const defaultEventColor: [string, string] = ['text-muted-foreground', 'bg-muted-foreground dark:bg-muted-foreground']

export function getEventColor(subtype: string | null, toolName?: string | null): { iconColor: string; dotColor: string; customHex?: string } {
  // Check user customizations first
  const keys: string[] = []
  if (subtype && toolName) keys.push(`${subtype}:${toolName}`)
  if (subtype) keys.push(subtype)

  for (const key of keys) {
    const custom = getIconCustomization(key)
    if (custom?.colorName === 'custom' && custom.customHex) {
      return { iconColor: '', dotColor: '', customHex: custom.customHex }
    }
    if (custom?.colorName && COLOR_PRESETS[custom.colorName]) {
      const preset = COLOR_PRESETS[custom.colorName]
      return { iconColor: preset.iconColor, dotColor: preset.dotColor }
    }
  }

  // Fall back to defaults
  let color: [string, string] | undefined
  if (subtype && toolName) {
    color = eventColors[`${subtype}:${toolName}`]
  }
  if (!color && subtype) {
    color = eventColors[subtype]
  }
  const [iconColor, dotColor] = color || defaultEventColor
  return { iconColor, dotColor }
}

export function getEventIcon(subtype: string | null, toolName?: string | null): LucideIcon {
  // Check user customizations first
  if (subtype && toolName) {
    const custom = getIconCustomization(`${subtype}:${toolName}`)
    if (custom?.iconName) {
      const icon = (allLucideIcons as Record<string, LucideIcon>)[custom.iconName]
      if (icon) return icon
    }
  }
  if (subtype) {
    const custom = getIconCustomization(subtype)
    if (custom?.iconName) {
      const icon = (allLucideIcons as Record<string, LucideIcon>)[custom.iconName]
      if (icon) return icon
    }
  }

  // Fall back to defaults
  if (subtype && toolName && eventIcons[`${subtype}:${toolName}`]) {
    return eventIcons[`${subtype}:${toolName}`]
  }
  if (subtype && eventIcons[subtype]) {
    return eventIcons[subtype]
  }
  return defaultEventIcon
}
