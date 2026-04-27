import { lazy } from 'react'
import type { LucideIcon } from 'lucide-react'
import dynamicIconImports from 'lucide-react/dynamicIconImports'
import {
  Rocket,
  Flag,
  CircleStop,
  Bomb,
  MessageSquare,
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
  Moon,
  ClipboardList,
  CircleCheck,
  Lock,
  Bell,
  FileText,
  Settings,
  FolderOpen,
  Minimize,
  CircleHelp,
  GitBranch,
  Trash,
  Pin,
  Plug,
} from 'lucide-react'
import { resolveIconName } from '@/lib/dynamic-icon'
import { getIconCustomization, COLOR_PRESETS } from '@/hooks/use-icon-customizations'

export interface EventIconEntry {
  /** Stable lookup key — what `processEvent` writes to `EnrichedEvent.iconId`. */
  id: string
  /** Display label shown in the Settings → Icons UI. */
  name: string
  /** Section header in the Settings UI. */
  group: string
  /** Default icon when the user hasn't customized this entry. */
  icon: LucideIcon
  /** Default Tailwind color classes when not customized. */
  defaultColor: { iconColor: string; dotColor: string }
}

const BLUE = {
  iconColor: 'text-blue-600 dark:text-blue-400',
  dotColor: 'bg-blue-600 dark:bg-blue-500',
}
const GREEN = {
  iconColor: 'text-green-600 dark:text-green-400',
  dotColor: 'bg-green-600 dark:bg-green-500',
}
const YELLOW = {
  iconColor: 'text-yellow-600 dark:text-yellow-400',
  dotColor: 'bg-yellow-600 dark:bg-yellow-500',
}
const RED = {
  iconColor: 'text-red-600 dark:text-red-400',
  dotColor: 'bg-red-600 dark:bg-red-500',
}
const PURPLE = {
  iconColor: 'text-purple-600 dark:text-purple-400',
  dotColor: 'bg-purple-600 dark:bg-purple-500',
}
const CYAN = {
  iconColor: 'text-cyan-600 dark:text-cyan-400',
  dotColor: 'bg-cyan-600 dark:bg-cyan-500',
}
const ROSE = {
  iconColor: 'text-rose-600 dark:text-rose-400',
  dotColor: 'bg-rose-600 dark:bg-rose-500',
}
const SKY = {
  iconColor: 'text-sky-600 dark:text-sky-400',
  dotColor: 'bg-sky-600 dark:bg-sky-500',
}
const SLATE = {
  iconColor: 'text-slate-600 dark:text-slate-400',
  dotColor: 'bg-slate-600 dark:bg-slate-500',
}
const GRAY = {
  iconColor: 'text-gray-500 dark:text-gray-400',
  dotColor: 'bg-gray-500 dark:bg-gray-400',
}
const INDIGO = {
  iconColor: 'text-indigo-600 dark:text-indigo-400',
  dotColor: 'bg-indigo-600 dark:bg-indigo-500',
}
const TEAL = {
  iconColor: 'text-teal-600 dark:text-teal-400',
  dotColor: 'bg-teal-600 dark:bg-teal-500',
}
const MUTED = {
  iconColor: 'text-muted-foreground',
  dotColor: 'bg-muted-foreground dark:bg-muted-foreground',
}

/**
 * Global registry of all event icons available to the dashboard.
 *
 * IDs are stable keys that `processEvent` implementations write to
 * `EnrichedEvent.iconId`. Tool icons are prefixed `Tool` to avoid
 * collisions with hookName-shaped IDs. Non-tool entries reuse the
 * hookName as their ID where there's no ambiguity.
 *
 * Adding a new entry: pick an unused id, add a row here, and reference
 * it from the relevant `processEvent`. No agent-class registration step.
 */
export const EVENT_ICON_REGISTRY: Record<string, EventIconEntry> = {
  // ---- Tools (prefix to avoid collision with hookNames) ---------------
  ToolBash: { id: 'ToolBash', name: 'Bash', group: 'Tools', icon: Zap, defaultColor: BLUE },
  ToolRead: { id: 'ToolRead', name: 'Read', group: 'Tools', icon: BookOpen, defaultColor: BLUE },
  ToolWrite: { id: 'ToolWrite', name: 'Write', group: 'Tools', icon: Pencil, defaultColor: BLUE },
  ToolEdit: { id: 'ToolEdit', name: 'Edit', group: 'Tools', icon: FilePen, defaultColor: BLUE },
  ToolGlob: { id: 'ToolGlob', name: 'Glob', group: 'Tools', icon: Search, defaultColor: BLUE },
  ToolGrep: { id: 'ToolGrep', name: 'Grep', group: 'Tools', icon: SearchCode, defaultColor: BLUE },
  ToolWebSearch: {
    id: 'ToolWebSearch',
    name: 'Web Search',
    group: 'Tools',
    icon: Globe,
    defaultColor: BLUE,
  },
  ToolWebFetch: {
    id: 'ToolWebFetch',
    name: 'Web Fetch',
    group: 'Tools',
    icon: Globe,
    defaultColor: BLUE,
  },
  ToolAgent: { id: 'ToolAgent', name: 'Agent', group: 'Tools', icon: Bot, defaultColor: PURPLE },
  ToolMcp: { id: 'ToolMcp', name: 'MCP Tool', group: 'Tools', icon: Plug, defaultColor: CYAN },
  ToolDefault: {
    id: 'ToolDefault',
    name: 'Tool (default)',
    group: 'Tools',
    icon: Wrench,
    defaultColor: BLUE,
  },

  // ---- Session lifecycle ----------------------------------------------
  SessionStart: {
    id: 'SessionStart',
    name: 'Session Start',
    group: 'Session',
    icon: Rocket,
    defaultColor: YELLOW,
  },
  SessionEnd: {
    id: 'SessionEnd',
    name: 'Session End',
    group: 'Session',
    icon: Flag,
    defaultColor: YELLOW,
  },
  Stop: { id: 'Stop', name: 'Stop', group: 'Session', icon: CircleStop, defaultColor: YELLOW },
  StopFailure: {
    id: 'StopFailure',
    name: 'Stop Failure',
    group: 'Session',
    icon: Bomb,
    defaultColor: RED,
  },
  stop_hook_summary: {
    id: 'stop_hook_summary',
    name: 'Stop Hook Summary',
    group: 'Session',
    icon: CircleStop,
    defaultColor: YELLOW,
  },

  // ---- User input ------------------------------------------------------
  UserPromptSubmit: {
    id: 'UserPromptSubmit',
    name: 'User Prompt',
    group: 'User Input',
    icon: MessageSquare,
    defaultColor: GREEN,
  },
  UserPromptExpansion: {
    id: 'UserPromptExpansion',
    name: 'Prompt Expansion',
    group: 'User Input',
    icon: SquareSlash,
    defaultColor: GREEN,
  },

  // ---- Subagents -------------------------------------------------------
  SubagentStart: {
    id: 'SubagentStart',
    name: 'Subagent Start',
    group: 'Agents',
    icon: Bot,
    defaultColor: PURPLE,
  },
  SubagentStop: {
    id: 'SubagentStop',
    name: 'Subagent Stop',
    group: 'Agents',
    icon: Bot,
    defaultColor: PURPLE,
  },
  TeammateIdle: {
    id: 'TeammateIdle',
    name: 'Teammate Idle',
    group: 'Agents',
    icon: Moon,
    defaultColor: PURPLE,
  },

  // ---- Tasks -----------------------------------------------------------
  TaskCreated: {
    id: 'TaskCreated',
    name: 'Task Created',
    group: 'Tasks',
    icon: ClipboardList,
    defaultColor: CYAN,
  },
  TaskCompleted: {
    id: 'TaskCompleted',
    name: 'Task Completed',
    group: 'Tasks',
    icon: CircleCheck,
    defaultColor: CYAN,
  },

  // ---- System / config -------------------------------------------------
  PermissionRequest: {
    id: 'PermissionRequest',
    name: 'Permission Request',
    group: 'System',
    icon: Lock,
    defaultColor: ROSE,
  },
  Notification: {
    id: 'Notification',
    name: 'Notification',
    group: 'System',
    icon: Bell,
    defaultColor: SKY,
  },
  InstructionsLoaded: {
    id: 'InstructionsLoaded',
    name: 'Instructions Loaded',
    group: 'System',
    icon: FileText,
    defaultColor: SLATE,
  },
  ConfigChange: {
    id: 'ConfigChange',
    name: 'Config Change',
    group: 'System',
    icon: Settings,
    defaultColor: SLATE,
  },
  CwdChanged: {
    id: 'CwdChanged',
    name: 'CWD Changed',
    group: 'System',
    icon: FolderOpen,
    defaultColor: SLATE,
  },
  FileChanged: {
    id: 'FileChanged',
    name: 'File Changed',
    group: 'System',
    icon: FilePen,
    defaultColor: SLATE,
  },

  // ---- Compaction ------------------------------------------------------
  PreCompact: {
    id: 'PreCompact',
    name: 'Pre-Compact',
    group: 'Compaction',
    icon: Minimize,
    defaultColor: GRAY,
  },
  PostCompact: {
    id: 'PostCompact',
    name: 'Post-Compact',
    group: 'Compaction',
    icon: Minimize,
    defaultColor: GRAY,
  },

  // ---- MCP -------------------------------------------------------------
  Elicitation: {
    id: 'Elicitation',
    name: 'Elicitation',
    group: 'MCP',
    icon: CircleHelp,
    defaultColor: INDIGO,
  },
  ElicitationResult: {
    id: 'ElicitationResult',
    name: 'Elicitation Result',
    group: 'MCP',
    icon: MessageSquare,
    defaultColor: INDIGO,
  },

  // ---- Worktree --------------------------------------------------------
  WorktreeCreate: {
    id: 'WorktreeCreate',
    name: 'Worktree Create',
    group: 'Worktree',
    icon: GitBranch,
    defaultColor: TEAL,
  },
  WorktreeRemove: {
    id: 'WorktreeRemove',
    name: 'Worktree Remove',
    group: 'Worktree',
    icon: Trash,
    defaultColor: TEAL,
  },

  // ---- Fallback --------------------------------------------------------
  Default: {
    id: 'Default',
    name: 'Default',
    group: 'System',
    icon: Pin,
    defaultColor: MUTED,
  },
}

const lazyIconCache = new Map<string, LucideIcon>()

/**
 * Resolve the icon component for an event. Honors user customization
 * (loaded synchronously from localStorage on each call), falls back to
 * the registry default, falls back to `Default`'s icon.
 */
export function resolveEventIcon(iconId: string | null | undefined): LucideIcon {
  const entry = (iconId && EVENT_ICON_REGISTRY[iconId]) || EVENT_ICON_REGISTRY.Default
  const custom = getIconCustomization(entry.id)
  if (custom?.iconName) {
    const resolved = resolveIconName(custom.iconName)
    if (resolved) {
      if (!lazyIconCache.has(resolved)) {
        lazyIconCache.set(resolved, lazy(dynamicIconImports[resolved]) as unknown as LucideIcon)
      }
      return lazyIconCache.get(resolved)!
    }
  }
  return entry.icon
}

/**
 * Resolve the color classes for an event. `customHex` is non-empty when
 * the user picked a custom color — callers should apply it via inline
 * style and ignore `iconColor`/`dotColor`.
 */
export function resolveEventColor(iconId: string | null | undefined): {
  iconColor: string
  dotColor: string
  customHex?: string
} {
  const entry = (iconId && EVENT_ICON_REGISTRY[iconId]) || EVENT_ICON_REGISTRY.Default
  const custom = getIconCustomization(entry.id)
  if (custom?.colorName === 'custom' && custom.customHex) {
    return { iconColor: '', dotColor: '', customHex: custom.customHex }
  }
  if (custom?.colorName && COLOR_PRESETS[custom.colorName]) {
    const preset = COLOR_PRESETS[custom.colorName]
    return { iconColor: preset.iconColor, dotColor: preset.dotColor }
  }
  return entry.defaultColor
}
