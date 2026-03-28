import { useState, useMemo } from 'react'
import { icons as allLucideIcons } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { eventIcons, defaultEventIcon } from '@/config/event-icons'
import { useIconCustomizations, COLOR_PRESETS } from '@/hooks/use-icon-customizations'
import { IconPicker } from './icon-picker'
import { ColorPicker } from './color-picker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'

// Determine default color key for each event type by matching its CSS classes
// against our COLOR_PRESETS. This is used for display and to detect changes.
function resolveDefaultColorKey(iconColor: string): string | undefined {
  for (const [key, preset] of Object.entries(COLOR_PRESETS)) {
    if (preset.iconColor === iconColor) return key
  }
  return undefined
}

// Build the static event list from defaults
interface EventEntry {
  key: string
  defaultIconName: string
  defaultColorKey: string | undefined
  defaultIconColorClass: string
  defaultDotColorClass: string
}

// Hardcoded default colors (mirrors the eventColors in event-icons.ts)
// We import the public eventIcons but eventColors is not exported,
// so we replicate the lookup via known color class patterns
const EVENT_COLOR_MAP: Record<string, [string, string]> = {
  SessionStart: ['text-yellow-600 dark:text-yellow-400', 'bg-yellow-600 dark:bg-yellow-500'],
  SessionEnd: ['text-yellow-600 dark:text-yellow-400', 'bg-yellow-600 dark:bg-yellow-500'],
  Stop: ['text-yellow-600 dark:text-yellow-400', 'bg-yellow-600 dark:bg-yellow-500'],
  StopFailure: ['text-red-600 dark:text-red-400', 'bg-red-600 dark:bg-red-500'],
  stop_hook_summary: ['text-yellow-600 dark:text-yellow-400', 'bg-yellow-600 dark:bg-yellow-500'],
  UserPromptSubmit: ['text-green-600 dark:text-green-400', 'bg-green-600 dark:bg-green-500'],
  UserPromptSubmitResponse: ['text-green-600 dark:text-green-400', 'bg-green-600 dark:bg-green-500'],
  user: ['text-green-600 dark:text-green-400', 'bg-green-600 dark:bg-green-500'],
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
  'PreToolUse:Agent': ['text-purple-600 dark:text-purple-400', 'bg-purple-600 dark:bg-purple-500'],
  'PostToolUse:Agent': ['text-purple-600 dark:text-purple-400', 'bg-purple-600 dark:bg-purple-500'],
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

const DEFAULT_EVENT_COLOR: [string, string] = ['text-muted-foreground', 'bg-muted-foreground dark:bg-muted-foreground']

/** Resolve the PascalCase name of a LucideIcon component */
function getIconComponentName(icon: LucideIcon): string {
  // lucide-react icons have a displayName property
  return (icon as { displayName?: string }).displayName || icon.name || 'Pin'
}

const EVENT_LIST: EventEntry[] = Object.keys(eventIcons).map((key) => {
  const [iconColor, dotColor] = EVENT_COLOR_MAP[key] || DEFAULT_EVENT_COLOR
  return {
    key,
    defaultIconName: getIconComponentName(eventIcons[key]),
    defaultColorKey: resolveDefaultColorKey(iconColor),
    defaultIconColorClass: iconColor,
    defaultDotColorClass: dotColor,
  }
})

export function IconSettings() {
  const { customizations, setCustomization, resetCustomization, resetAll } = useIconCustomizations()
  const [filter, setFilter] = useState('')

  const hasAnyCustomizations = Object.keys(customizations).length > 0

  const filteredEvents = useMemo(() => {
    if (!filter) return EVENT_LIST
    const lower = filter.toLowerCase()
    return EVENT_LIST.filter((e) => e.key.toLowerCase().includes(lower))
  }, [filter])

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-2">
        <Input
          placeholder="Filter event types..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="h-8 text-sm"
        />
        {hasAnyCustomizations && (
          <Button
            variant="ghost"
            size="xs"
            onClick={resetAll}
            className="shrink-0 text-muted-foreground"
            title="Reset all customizations"
          >
            <RotateCcw className="h-3 w-3" />
            Reset all
          </Button>
        )}
      </div>

      <ScrollArea className="flex-1 -mx-1">
        <div className="space-y-0.5 px-1">
          {filteredEvents.map((entry) => (
            <EventRow
              key={entry.key}
              entry={entry}
              customization={customizations[entry.key]}
              onChangeIcon={(iconName) => setCustomization(entry.key, { iconName })}
              onChangeColor={(colorName) => setCustomization(entry.key, { colorName })}
              onReset={() => resetCustomization(entry.key)}
            />
          ))}
          {filteredEvents.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No event types match your filter.
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

interface EventRowProps {
  entry: EventEntry
  customization: { iconName?: string; colorName?: string } | undefined
  onChangeIcon: (iconName: string) => void
  onChangeColor: (colorName: string) => void
  onReset: () => void
}

function EventRow({ entry, customization, onChangeIcon, onChangeColor, onReset }: EventRowProps) {
  const hasCustom = !!customization
  const activeIconName = customization?.iconName || entry.defaultIconName
  const activeColorKey = customization?.colorName || entry.defaultColorKey

  // Resolve actual icon component for preview
  const Icon = (allLucideIcons as Record<string, LucideIcon>)[activeIconName] || defaultEventIcon

  // Resolve active color class
  const activeIconColorClass = activeColorKey && COLOR_PRESETS[activeColorKey]
    ? COLOR_PRESETS[activeColorKey].iconColor
    : entry.defaultIconColorClass

  // Default swatch for color picker
  const defaultSwatch = entry.defaultColorKey
    ? COLOR_PRESETS[entry.defaultColorKey]?.swatch
    : '#6b7280'

  return (
    <div
      className={cn(
        'group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent/50',
        hasCustom && 'bg-accent/30',
      )}
    >
      {/* Preview icon */}
      <Icon className={cn('h-4 w-4 shrink-0', activeIconColorClass)} />

      {/* Event name */}
      <span className="flex-1 truncate font-mono text-xs">{entry.key}</span>

      {/* Icon picker */}
      <IconPicker
        currentIconName={activeIconName}
        iconColorClass={activeIconColorClass}
        onSelect={onChangeIcon}
      />

      {/* Color picker */}
      <ColorPicker
        currentColor={activeColorKey}
        onSelect={onChangeColor}
        defaultSwatch={defaultSwatch}
      />

      {/* Reset button (only visible when customized) */}
      {hasCustom && (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onReset}
          className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
          title="Reset to default"
        >
          <RotateCcw className="h-3 w-3" />
        </Button>
      )}
    </div>
  )
}
