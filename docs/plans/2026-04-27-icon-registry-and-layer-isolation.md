# Icon Registry + Layer Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Eliminate every layer leak where core code imports from agent-class libs, and replace the per-class icon/color resolvers with a single global icon registry. After this lands, no file outside `app/client/src/agents/<class>/` imports from any agent-class lib.

**Architecture:** A core `lib/event-icon-registry.ts` owns all event icon entries (id, display name, group, default Lucide icon, default color). Each agent class's `processEvent` sets `EnrichedEvent.iconId: string` to a registry key. Renderers call `resolveEventIcon(iconId)` / `resolveEventColor(iconId)` at render time, which picks up user customizations from localStorage. The framework's `EnrichedEvent` drops the resolved-icon fields (`icon`, `iconColor`, `dotColor`, `iconColorHex`) — they collapse into `iconId`. The `AgentClassRegistration` drops `getEventIcon` / `getEventColor` since icon resolution is no longer per-class. The `match()` callback pattern in `config/filters.ts` goes away — filtering reads `filterTags` and `status` only. The legacy `lib/event-summary.ts`, `config/event-icons.ts`, `claude-code/icons.ts`, and `hooks/use-deduped-events.ts` files are deleted.

**Tech Stack:** TypeScript, React 19, Vitest.

---

## File Structure

### Core (new)

- **Create:** `app/client/src/lib/event-icon-registry.ts` — global registry + resolver functions (`resolveEventIcon`, `resolveEventColor`).

### Core (modified)

- **Modify:** `app/client/src/agents/types.ts` — `EnrichedEvent`: drop `icon`, `iconColor`, `dotColor`, `iconColorHex`; add `iconId: string`. `AgentClassRegistration`: drop `getEventIcon` and `getEventColor`.
- **Modify:** `app/client/src/components/event-stream/event-row.tsx` — replace `registration.getEventIcon` / `getEventColor` calls with `resolveEventIcon` / `resolveEventColor`.
- **Modify:** `app/client/src/agents/claude-code/event-detail.tsx` — same.
- **Modify:** `app/client/src/components/timeline/dot-tooltip.tsx` — consume `EnrichedEvent` not `ParsedEvent`. Drop `deriveToolName` import. Drop the `tooltipLabel` helper (use `event.label`). Drop `getEventSummary` call (use `event.summary`).
- **Modify:** `app/client/src/components/timeline/timeline-rewind.tsx` — consume `EnrichedEvent[]` from `useProcessedEvents()`. Filter by `displayTimeline`. Drop `useDedupedEvents`, `deriveToolName`, `config/event-icons` imports. Use `resolveEventIcon` / `resolveEventColor`.
- **Modify:** `app/client/src/components/settings/icon-settings.tsx` — iterate `EVENT_ICON_REGISTRY` instead of `CURATED_EVENTS`. Use `entry.name` / `entry.group` for display.
- **Modify:** `app/client/src/hooks/use-icon-customizations.ts` — add a one-time localStorage migration that maps old keys (`Bash` → `ToolBash`, `_MCP` → `ToolMcp`, etc.) to new IDs.
- **Modify:** `app/client/src/config/filters.ts` — drop `match()` callbacks. Filter by `filterTags.static`, `filterTags.dynamic`, and `event.status === 'failed'`. The match-function field comes off `StaticFilter`.

### Per-class (modified)

- **Modify:** `app/client/src/agents/claude-code/process-event.ts` — set `iconId` via a new `pickIconId(hookName, toolName)` helper. Drop writes to `icon`, `iconColor`, `dotColor`, `iconColorHex`. Bump `status` to `'failed'` when `payload.error`/`tool_response.is_error`/`tool_response.error` indicates a payload-level error (so the Errors filter can use `event.status === 'failed'`).
- **Modify:** `app/client/src/agents/claude-code/index.ts` — drop `getEventIcon` / `getEventColor` from registration.
- **Modify:** `app/client/src/agents/default/index.tsx` — same drop. `processEvent` sets `iconId: 'Default'`.
- **Modify:** `app/client/src/agents/codex/index.tsx` — same drop. `iconId: 'Default'`.

### Deletions

- **Delete:** `app/client/src/lib/event-summary.ts` (re-derives summary from raw events; legacy)
- **Delete:** `app/client/src/lib/event-summary.test.ts`
- **Delete:** `app/client/src/config/event-icons.ts` (re-export shim)
- **Delete:** `app/client/src/agents/claude-code/icons.ts` (contents move to the registry)
- **Delete:** `app/client/src/hooks/use-deduped-events.ts` (duplicate dedup; rewind uses enriched events now)

### Tests (added)

- **Add:** `app/client/src/lib/event-icon-registry.test.ts` — covers `resolveEventIcon` / `resolveEventColor`, fallback to `Default`, customization override.

---

## Sequencing

Five phases. Phase 1 is foundation. Phases 2–4 cascade through processEvent + renderers. Phase 5 is filter cleanup + dead-code deletion + verification.

---

## Phase 1: Build the registry

### Task 1: Create `lib/event-icon-registry.ts`

**Files:**
- Create: `app/client/src/lib/event-icon-registry.ts`
- Test: `app/client/src/lib/event-icon-registry.test.ts`

- [ ] **Step 1: Write the registry**

Create `app/client/src/lib/event-icon-registry.ts`:

```typescript
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

// Color presets shared across many entries. Keeping them as constants
// keeps the registry table readable.
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
```

- [ ] **Step 2: Write the registry test**

Create `app/client/src/lib/event-icon-registry.test.ts`:

```typescript
import { describe, test, expect, beforeEach } from 'vitest'
import { EVENT_ICON_REGISTRY, resolveEventIcon, resolveEventColor } from './event-icon-registry'

beforeEach(() => {
  localStorage.clear()
})

describe('EVENT_ICON_REGISTRY', () => {
  test('every entry has matching id field', () => {
    for (const [key, entry] of Object.entries(EVENT_ICON_REGISTRY)) {
      expect(entry.id).toBe(key)
    }
  })

  test('Default entry exists', () => {
    expect(EVENT_ICON_REGISTRY.Default).toBeDefined()
  })

  test('all tool ids are prefixed with Tool', () => {
    const toolEntries = Object.values(EVENT_ICON_REGISTRY).filter((e) => e.group === 'Tools')
    expect(toolEntries.length).toBeGreaterThan(0)
    for (const entry of toolEntries) {
      expect(entry.id.startsWith('Tool')).toBe(true)
    }
  })
})

describe('resolveEventIcon', () => {
  test('returns the registered icon for a known id', () => {
    expect(resolveEventIcon('ToolBash')).toBe(EVENT_ICON_REGISTRY.ToolBash.icon)
  })

  test('falls back to Default for an unknown id', () => {
    expect(resolveEventIcon('SomeFutureId')).toBe(EVENT_ICON_REGISTRY.Default.icon)
  })

  test('falls back to Default for null / undefined', () => {
    expect(resolveEventIcon(null)).toBe(EVENT_ICON_REGISTRY.Default.icon)
    expect(resolveEventIcon(undefined)).toBe(EVENT_ICON_REGISTRY.Default.icon)
  })
})

describe('resolveEventColor', () => {
  test('returns the registered defaultColor for a known id', () => {
    const got = resolveEventColor('ToolBash')
    expect(got.iconColor).toBe(EVENT_ICON_REGISTRY.ToolBash.defaultColor.iconColor)
    expect(got.dotColor).toBe(EVENT_ICON_REGISTRY.ToolBash.defaultColor.dotColor)
    expect(got.customHex).toBeUndefined()
  })

  test('user color override (preset) wins over default', () => {
    localStorage.setItem(
      'observe-icon-customizations',
      JSON.stringify({ ToolBash: { colorName: 'red' } }),
    )
    const got = resolveEventColor('ToolBash')
    expect(got.iconColor).toContain('red')
  })

  test('user color override (custom hex) returns customHex', () => {
    localStorage.setItem(
      'observe-icon-customizations',
      JSON.stringify({ ToolBash: { colorName: 'custom', customHex: '#ff5500' } }),
    )
    const got = resolveEventColor('ToolBash')
    expect(got.customHex).toBe('#ff5500')
  })

  test('falls back to Default color for an unknown id', () => {
    const got = resolveEventColor('SomeFutureId')
    expect(got.iconColor).toBe(EVENT_ICON_REGISTRY.Default.defaultColor.iconColor)
  })
})
```

- [ ] **Step 3: Run the tests**

```
cd app/client && pnpm vitest run src/lib/event-icon-registry.test.ts
```

Expected: PASS — all 9 tests.

- [ ] **Step 4: Commit**

```bash
git add app/client/src/lib/event-icon-registry.ts app/client/src/lib/event-icon-registry.test.ts
git commit -m "feat(client): add global event icon registry"
```

---

### Task 2: Add localStorage migration for old icon-customization keys

**Files:**
- Modify: `app/client/src/hooks/use-icon-customizations.ts`

- [ ] **Step 1: Add a migration table + run it once on first read**

In `app/client/src/hooks/use-icon-customizations.ts`, find where `STORAGE_KEY` localStorage is read (likely a function that loads + parses the JSON). Add a one-time migration:

```typescript
const ID_MIGRATION: Record<string, string> = {
  // Tools — un-prefixed → prefixed
  Bash: 'ToolBash',
  Read: 'ToolRead',
  Write: 'ToolWrite',
  Edit: 'ToolEdit',
  Glob: 'ToolGlob',
  Grep: 'ToolGrep',
  WebSearch: 'ToolWebSearch',
  WebFetch: 'ToolWebFetch',
  Agent: 'ToolAgent',
  // Underscore-prefixed → registry IDs
  _MCP: 'ToolMcp',
  _ToolDefault: 'ToolDefault',
  // Dropped entries (no longer in the registry — the customization is silently lost)
  _ToolSuccess: '',
  _ToolFailure: '',
  system: '',
  user: '',
  assistant: '',
  agent_progress: '',
  progress: '',
  UserPromptSubmitResponse: '',
}

const MIGRATION_FLAG_KEY = 'observe-icon-customizations-v2-migrated'

function migrateIfNeeded(raw: string): string {
  if (typeof window === 'undefined') return raw
  if (window.localStorage.getItem(MIGRATION_FLAG_KEY) === '1') return raw
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return raw
  } catch {
    return raw
  }
  const next: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(parsed)) {
    if (key in ID_MIGRATION) {
      const newKey = ID_MIGRATION[key]
      if (newKey) next[newKey] = val // drop entry if mapped to ''
    } else {
      next[key] = val // keep IDs that didn't change (e.g. SessionStart)
    }
  }
  const migrated = JSON.stringify(next)
  try {
    window.localStorage.setItem(STORAGE_KEY, migrated)
    window.localStorage.setItem(MIGRATION_FLAG_KEY, '1')
  } catch {
    // ignore quota errors
  }
  return migrated
}
```

Then wherever the file reads `localStorage.getItem(STORAGE_KEY)` to load customizations, wrap the result in `migrateIfNeeded(...)`. The getter function already exists — read the file first to find its exact name.

- [ ] **Step 2: Run typecheck**

```
just check
```

Expected: existing tests + new registry tests pass.

- [ ] **Step 3: Commit**

```bash
git add app/client/src/hooks/use-icon-customizations.ts
git commit -m "feat(client): migrate old icon-customization keys to registry IDs"
```

---

## Phase 2: Switch EnrichedEvent + AgentClassRegistration

### Task 3: Update `EnrichedEvent` to use `iconId`

**Files:**
- Modify: `app/client/src/agents/types.ts`

- [ ] **Step 1: Replace icon fields with `iconId`**

In `app/client/src/agents/types.ts`, in the `EnrichedEvent` interface:

- Remove fields: `icon: ComponentType | null`, `iconColor: string | null`, `dotColor: string | null`, `iconColorHex: string | null`
- Add field: `iconId: string`

The new field should sit where the old `icon` field was. Update the section comment if it referenced the resolved fields.

- [ ] **Step 2: Drop `getEventIcon` and `getEventColor` from `AgentClassRegistration`**

In the same file, in `AgentClassRegistration<TEvent>`, remove these two members:

```typescript
getEventIcon(event: TEvent): ComponentType<{ className?: string }>
getEventColor(event: TEvent): EventColor
```

The block comment "Render-time icon/color resolvers" can be deleted along with them. Keep `EventColor` exported (it's still used by tests + may be used elsewhere) — verify with `grep -rn "EventColor" app/client/src --include="*.ts" --include="*.tsx"`. If unused after this commit, delete it too.

The `ComponentType` import at the top of types.ts may now be unused — drop it if so.

- [ ] **Step 3: Typecheck (expect a wave of errors)**

```
just check
```

Expected: errors in `event-row.tsx`, `event-detail.tsx`, `claude-code/index.ts`, `claude-code/process-event.ts`, `default/index.tsx`, `codex/index.tsx`, `timeline-rewind.tsx` (anywhere reading or writing the dropped fields). All addressed in subsequent tasks. Do not fix yet.

- [ ] **Step 4: Commit (broken-tree marker)**

```bash
git add app/client/src/agents/types.ts
git commit --no-verify -m "refactor(types): EnrichedEvent uses iconId; drop getEventIcon/getEventColor [WIP]"
```

---

## Phase 3: Per-class processEvent updates

### Task 4: Update claude-code processEvent + registration

**Files:**
- Modify: `app/client/src/agents/claude-code/process-event.ts`
- Modify: `app/client/src/agents/claude-code/index.ts`

- [ ] **Step 1: Add `pickIconId` helper + status bump for payload errors**

In `app/client/src/agents/claude-code/process-event.ts`, near the top (after imports), add:

```typescript
function pickIconId(hookName: string, toolName: string | null): string {
  const isTool =
    hookName === 'PreToolUse' || hookName === 'PostToolUse' || hookName === 'PostToolUseFailure'
  if (isTool) {
    if (toolName?.startsWith('mcp__')) return 'ToolMcp'
    const map: Record<string, string> = {
      Bash: 'ToolBash',
      Read: 'ToolRead',
      Write: 'ToolWrite',
      Edit: 'ToolEdit',
      Glob: 'ToolGlob',
      Grep: 'ToolGrep',
      WebSearch: 'ToolWebSearch',
      WebFetch: 'ToolWebFetch',
      Agent: 'ToolAgent',
    }
    return map[toolName ?? ''] ?? 'ToolDefault'
  }
  // Direct passthrough — registry has these IDs.
  return EVENT_ICON_REGISTRY[hookName] ? hookName : 'Default'
}
```

Add the import at the top:

```typescript
import { EVENT_ICON_REGISTRY } from '@/lib/event-icon-registry'
```

- [ ] **Step 2: Drop the icon resolution + write `iconId`**

Find the section in `processEvent` that currently resolves icon/color (around the line `const icon = getEventIcon(hookName, toolName)`). Delete those resolution lines:

```typescript
// DELETE:
const icon = getEventIcon(hookName, toolName)
const { iconColor, dotColor, customHex } = getEventColor(hookName, toolName)
```

Replace with:

```typescript
const iconId = pickIconId(hookName, toolName)
```

In the enriched-event object literal at the bottom of `processEvent`:

- Remove: `icon`, `iconColor`, `dotColor`, `iconColorHex` writes.
- Add: `iconId,` (where `icon` used to be).

- [ ] **Step 3: Bump status to 'failed' for payload-level errors**

Find `deriveLocalStatus(hookName)` — its result is what gets stored as `status` for the enriched event when `statusOverride` is null. Wrap the status assignment so that payload-level errors bump it to `'failed'`:

Locate the line `status: statusOverride ?? deriveLocalStatus(hookName),` and replace with:

```typescript
status:
  statusOverride ??
  (isPayloadFailed(p) ? 'failed' : deriveLocalStatus(hookName)),
```

Add the helper near the other internal helpers in this file:

```typescript
function isPayloadFailed(payload: Record<string, any>): boolean {
  if (typeof payload.error === 'string' && payload.error !== '') return true
  const tr = payload.tool_response
  if (tr && typeof tr === 'object') {
    if ((tr as Record<string, unknown>).is_error === true) return true
    const err = (tr as Record<string, unknown>).error
    if (typeof err === 'string' && err !== '') return true
  }
  return false
}
```

- [ ] **Step 4: Drop the now-unused imports**

`getEventIcon` and `getEventColor` from `./icons` are no longer called inside `processEvent`. Remove them from the import statement. Phase 5 deletes `icons.ts` entirely.

- [ ] **Step 5: Update `claude-code/index.ts` to drop `getEventIcon` / `getEventColor`**

In `app/client/src/agents/claude-code/index.ts`:

- Remove the `getEventIcon` import line (`import { getEventIcon, getEventColor } from './icons'`).
- In the registration object, delete the `getEventIcon: ...` and `getEventColor: ...` entries.

If after this change the file doesn't import anything from `./icons`, that's fine — Phase 5 deletes `icons.ts`.

- [ ] **Step 6: Typecheck**

```
just check
```

Expected: errors limited to renderers (`event-row.tsx`, `event-detail.tsx`), default + codex registrations, and the timeline files. All fixed in subsequent tasks.

- [ ] **Step 7: Commit**

```bash
git add app/client/src/agents/claude-code/process-event.ts app/client/src/agents/claude-code/index.ts
git commit --no-verify -m "refactor(claude-code): processEvent writes iconId; bump status on payload errors [WIP]"
```

---

### Task 5: Update default + codex agents

**Files:**
- Modify: `app/client/src/agents/default/index.tsx`
- Modify: `app/client/src/agents/codex/index.tsx`

- [ ] **Step 1: Update `default/index.tsx`**

In `app/client/src/agents/default/index.tsx`:

- In the enriched-event object literal inside `processEvent`, remove `icon`, `iconColor`, `dotColor`, `iconColorHex` writes. Add `iconId: 'Default',`.
- Remove the `getEventIcon: () => CircleDot` and `getEventColor: () => ({ ... })` entries from the `AgentRegistry.registerDefault({...})` call.
- The `CircleDot` import is now only used as the `Icon` field of the registration (the agent-class icon shown in the UI, not the per-event icon). Keep that.

- [ ] **Step 2: Update `codex/index.tsx`**

In `app/client/src/agents/codex/index.tsx`:

- Remove the `getEventIcon: () => Terminal` and `getEventColor: () => ({ ... })` entries from the `AgentRegistry.register({...})` call.
- (Codex reuses default's `processEvent` so no change to processing.)

- [ ] **Step 3: Typecheck**

```
just check
```

Expected: errors only in renderers + timeline. Fixed next.

- [ ] **Step 4: Commit**

```bash
git add app/client/src/agents/default/index.tsx app/client/src/agents/codex/index.tsx
git commit --no-verify -m "refactor(default+codex): drop getEventIcon/getEventColor; processEvent sets iconId [WIP]"
```

---

## Phase 4: Renderers

### Task 6: Update `event-row.tsx` to use the registry resolver

**Files:**
- Modify: `app/client/src/components/event-stream/event-row.tsx`

- [ ] **Step 1: Replace `registration.getEventIcon` / `getEventColor` with resolver calls**

In `app/client/src/components/event-stream/event-row.tsx`, find:

```typescript
const Icon = registration.getEventIcon(event)
const { iconColor, customHex } = registration.getEventColor(event)
```

Replace with:

```typescript
const Icon = resolveEventIcon(event.iconId)
const { iconColor, customHex } = resolveEventColor(event.iconId)
```

Add the import:

```typescript
import { resolveEventIcon, resolveEventColor } from '@/lib/event-icon-registry'
```

If `registration` is no longer used after this change (other than for `RowSummary` / `EventDetail`), keep it — those are still per-class. If the `AgentRegistry.get(...)` call becomes the only use, it's still needed for the components.

- [ ] **Step 2: Typecheck**

```
just check
```

Expected: errors in `event-detail.tsx` and `timeline-rewind.tsx` remain. event-row.tsx is clean.

- [ ] **Step 3: Commit**

```bash
git add app/client/src/components/event-stream/event-row.tsx
git commit --no-verify -m "refactor(event-row): resolve icon/color from registry [WIP]"
```

---

### Task 7: Update `claude-code/event-detail.tsx` to use the resolver

**Files:**
- Modify: `app/client/src/agents/claude-code/event-detail.tsx`

- [ ] **Step 1: Find the icon resolution call**

`event-detail.tsx` resolves an icon for the thread display. Find:

```typescript
const Icon = event.icon || getEventIcon(event.hookName, event.toolName)
```

(Approximately line 1097.) Replace with:

```typescript
const Icon = resolveEventIcon(event.iconId)
```

Add import at the top:

```typescript
import { resolveEventIcon } from '@/lib/event-icon-registry'
```

Drop the import of `getEventIcon` from `./icons`.

- [ ] **Step 2: Search for any other reads of `event.icon`, `event.iconColor`, `event.dotColor`, `event.iconColorHex`**

```
grep -n "event\.\(icon\|iconColor\|dotColor\|iconColorHex\)" app/client/src/agents/claude-code/event-detail.tsx
```

For each match, replace with the resolver call appropriate to context (icon component or color object). If a read is no longer needed after the iconId migration, delete it.

- [ ] **Step 3: Typecheck**

```
just check
```

Expected: errors only in `dot-tooltip.tsx` (timeline) and `timeline-rewind.tsx`.

- [ ] **Step 4: Commit**

```bash
git add app/client/src/agents/claude-code/event-detail.tsx
git commit --no-verify -m "refactor(claude-code): event-detail resolves icon from registry [WIP]"
```

---

### Task 8: Refactor timeline `dot-tooltip.tsx` to consume `EnrichedEvent`

**Files:**
- Modify: `app/client/src/components/timeline/dot-tooltip.tsx`

- [ ] **Step 1: Replace the file**

Replace `app/client/src/components/timeline/dot-tooltip.tsx` entirely with:

```typescript
import { format } from 'timeago.js'
import type { EnrichedEvent } from '@/agents/types'

function formatTimeOfDay(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

/**
 * Tooltip content for a timeline dot. The computations inside this component
 * only run when the tooltip is actually open — Radix's TooltipContent uses
 * Presence to mount children lazily, so rendering thousands of tooltip
 * elements in the parent's JSX has near-zero cost until one is shown.
 */
export function DotTooltipContent({ event }: { event: EnrichedEvent }) {
  const time = formatTimeOfDay(event.timestamp)
  const relative = format(event.timestamp)
  // Show hookName as a secondary line only if it differs from the label
  // (most events have label === hookName so this collapses).
  const hookLine = event.hookName !== event.label ? event.hookName : null

  return (
    <>
      <div className="flex items-baseline gap-2">
        <span className="font-medium">{event.label}</span>
        {hookLine && (
          <span className="ml-auto text-[10px] font-normal opacity-70">{hookLine}</span>
        )}
      </div>
      {event.summary && <div className="opacity-80 truncate">{event.summary}</div>}
      <div className="text-[10px] font-medium tabular-nums mt-0.5">
        {time} <span className="opacity-80">({relative})</span>
      </div>
    </>
  )
}
```

This drops:
- `getEventSummary` from `@/lib/event-summary` (the legacy wrapper)
- `deriveToolName` from `@/agents/claude-code/derivers` (layer leak)
- The `tooltipLabel` helper (replaced by `event.label`)

- [ ] **Step 2: Typecheck**

```
just check
```

Expected: errors in `timeline-rewind.tsx` only.

- [ ] **Step 3: Commit**

```bash
git add app/client/src/components/timeline/dot-tooltip.tsx
git commit --no-verify -m "refactor(timeline): dot-tooltip consumes EnrichedEvent [WIP]"
```

---

### Task 9: Refactor `timeline-rewind.tsx` to consume `EnrichedEvent[]`

**Files:**
- Modify: `app/client/src/components/timeline/timeline-rewind.tsx`

- [ ] **Step 1: Read the file in full**

Read `app/client/src/components/timeline/timeline-rewind.tsx` to understand the layout: it uses `useEffectiveEvents` to get raw events, runs them through `useDedupedEvents`, then iterates dots per agent.

- [ ] **Step 2: Switch the data source to `useProcessedEvents()`**

At the top of the component (around the place that calls `useEffectiveEvents` / `useDedupedEvents`), replace:

```typescript
import { useDedupedEvents } from '@/hooks/use-deduped-events'
// ...
const events = ...  // ParsedEvent[] from useEffectiveEvents
const deduped = useDedupedEvents(events)
```

with:

```typescript
import { useProcessedEvents } from '@/agents/event-processing-context'
// ...
const { events: enrichedEvents } = useProcessedEvents()
const visible = useMemo(() => enrichedEvents.filter((e) => e.displayTimeline), [enrichedEvents])
```

Use `visible` everywhere `deduped` was used.

The `findFirstEventAtOrAfter` exported helper still takes `ParsedEvent[]` per its signature. Since `EnrichedEvent` extends the wire shape via its own fields and has `timestamp: number`, it satisfies the same shape. Update the parameter type:

```typescript
export function findFirstEventAtOrAfter<T extends { timestamp: number }>(events: T[], targetTs: number): number {
  // ... unchanged body
}
```

- [ ] **Step 3: Drop `deriveToolName` + direct icon resolver imports**

In the per-event JSX (the `agentEvents.map((event) => { ... })` block), find:

```typescript
const hookName = event.hookName || null
const toolName = deriveToolName(event)
const Icon = getEventIcon(hookName, toolName)
const { dotColor, customHex } = getEventColor(hookName, toolName)
```

Replace with:

```typescript
const Icon = resolveEventIcon(event.iconId)
const { dotColor, customHex } = resolveEventColor(event.iconId)
```

Update imports:

- Remove: `import { deriveToolName } from '@/agents/claude-code/derivers'`
- Remove: `import { getEventIcon, getEventColor } from '@/config/event-icons'`
- Add: `import { resolveEventIcon, resolveEventColor } from '@/lib/event-icon-registry'`

- [ ] **Step 4: Update `<DotTooltipContent event={event} />` to pass the EnrichedEvent**

This is now correct automatically — `event` is already typed as `EnrichedEvent` and `DotTooltipContent` (after Task 8) accepts that. No code change needed; verify by typecheck.

- [ ] **Step 5: Verify `agentEvents` typing**

Wherever `agentEvents` is computed (filtered/grouped from `visible`), it should be `EnrichedEvent[]`. Update any `ParsedEvent[]` annotations to `EnrichedEvent[]`.

- [ ] **Step 6: Typecheck**

```
just check
```

Expected: tree compiles. Tests pass.

- [ ] **Step 7: Commit**

```bash
git add app/client/src/components/timeline/timeline-rewind.tsx
git commit --no-verify -m "refactor(timeline): rewind consumes EnrichedEvent[] from processing context"
```

(No `[WIP]` — tree should be green at this point.)

---

### Task 10: Update icon-settings to iterate the registry

**Files:**
- Modify: `app/client/src/components/settings/icon-settings.tsx`

- [ ] **Step 1: Replace the file's data source**

In `app/client/src/components/settings/icon-settings.tsx`:

1. Replace the import line `import { eventIcons, eventColors, defaultEventIcon } from '@/config/event-icons'` with:

```typescript
import { EVENT_ICON_REGISTRY, type EventIconEntry } from '@/lib/event-icon-registry'
```

2. Delete the `CURATED_EVENTS` constant (the manually-curated list of `{key, label, category}` rows).

3. Where `CURATED_EVENTS` was iterated to render groups, replace with iteration over `Object.values(EVENT_ICON_REGISTRY)`. The fields map: `entry.id` → was `key`, `entry.name` → was `label`, `entry.group` → was `category`.

4. Where the file used `eventIcons[key]`, `eventColors[key]`, or `defaultEventIcon` to look up defaults, use `entry.icon` and `entry.defaultColor` directly.

5. The `resolveDefaultColorKey(iconColor)` helper that maps a Tailwind class string to a preset key still works — it just receives `entry.defaultColor.iconColor` instead of `eventColors[key][0]`.

- [ ] **Step 2: Typecheck**

```
just check
```

Expected: file compiles. `config/event-icons.ts` is now unused (Phase 5 deletes it).

- [ ] **Step 3: Commit**

```bash
git add app/client/src/components/settings/icon-settings.tsx
git commit -m "refactor(settings): icon-settings iterates global registry"
```

---

## Phase 5: Filters cleanup + dead-code deletion

### Task 11: Refactor `config/filters.ts` to drop `match()` callbacks

**Files:**
- Modify: `app/client/src/config/filters.ts`

- [ ] **Step 1: Read the current file**

Read `app/client/src/config/filters.ts` to see the existing structure.

- [ ] **Step 2: Replace the file**

Replace `app/client/src/config/filters.ts` entirely with the new pattern (no `match` callbacks; pure data lookup against `filterTags` and `status`):

```typescript
import type { EnrichedEvent } from '@/agents/types'

export interface StaticFilter {
  label: string
  /** Static category that `processEvent` writes to `filterTags.static`.
   *  An event matches this filter if its filterTag matches OR — for the
   *  special "Errors" filter — `event.status === 'failed'`. */
  category?: string
  /** Special-case for the Errors filter, which matches across categories. */
  matchesErrors?: boolean
}

export const STATIC_FILTERS: StaticFilter[] = [
  { label: 'Prompts', category: 'Prompts' },
  { label: 'Tools', category: 'Tools' },
  { label: 'Agents', category: 'Agents' },
  { label: 'Tasks', category: 'Tasks' },
  { label: 'Session', category: 'Session' },
  { label: 'MCP', category: 'MCP' },
  { label: 'Permissions', category: 'Permissions' },
  { label: 'Notifications', category: 'Notifications' },
  { label: 'Stop', category: 'Stop' },
  { label: 'Compaction', category: 'Compaction' },
  { label: 'Errors', matchesErrors: true },
  { label: 'Config', category: 'Config' },
]

/**
 * Test whether an event matches a static filter.
 *
 * `Errors` is the only cross-category filter — it matches any event with
 * `status === 'failed'`. Every other filter is a pure category lookup
 * against `filterTags.static`.
 */
export function matchesStaticFilter(event: EnrichedEvent, filter: StaticFilter): boolean {
  if (filter.matchesErrors) return event.status === 'failed'
  if (filter.category) return event.filterTags.static === filter.category
  return false
}

/**
 * Aggregate the unique dynamic filter names present in an event list.
 * Used by the filter bar to render the second-row pills (`Bash`, `Grep`,
 * `mcp__chrome-devtools`, etc.).
 */
export function getDynamicFilterNames(events: EnrichedEvent[]): string[] {
  const names = new Set<string>()
  for (const e of events) {
    for (const tag of e.filterTags.dynamic) names.add(tag)
  }
  return [...names].sort()
}

/** Test whether an event matches a dynamic filter (toolName-style pill). */
export function matchesDynamicFilter(event: EnrichedEvent, name: string): boolean {
  return event.filterTags.dynamic.includes(name)
}
```

What's gone:
- The `match()` callback on `StaticFilter` — no more re-deriving subtype/toolName at filter time.
- The bespoke `Tools` / `Agents` / `Tasks` / `MCP` matchers that overlapped with category lookup.
- The `Errors` filter's payload introspection — `processEvent` now bumps `status` to `'failed'` for those payloads (Task 4 step 3), so the filter is just a status check.
- `deriveToolName` import.

- [ ] **Step 3: Update callers of the filter helpers**

The filter-bar component (`event-filter-bar.tsx` or similar) calls these helpers. Find usages:

```
grep -rn "STATIC_FILTERS\|matchesStaticFilter\|getDynamicFilterNames\|matchesDynamicFilter" app/client/src --include="*.ts" --include="*.tsx"
```

If existing call sites pass `ParsedEvent[]`, update them to pass `EnrichedEvent[]` from `useProcessedEvents()`. If the existing call sites previously called `filter.match(event, subtype, toolName)`, replace with `matchesStaticFilter(event, filter)`.

- [ ] **Step 4: Typecheck**

```
just check
```

Expected: PASS. Tree compiles.

- [ ] **Step 5: Commit**

```bash
git add app/client/src/config/filters.ts app/client/src/components/main-panel/event-filter-bar.tsx
git commit -m "refactor(filters): drop match callbacks; use filterTags + status only"
```

(Adjust the `git add` line to match whatever files Step 3 actually touched.)

---

### Task 12: Delete dead code

**Files:**
- Delete: `app/client/src/lib/event-summary.ts`
- Delete: `app/client/src/lib/event-summary.test.ts`
- Delete: `app/client/src/config/event-icons.ts`
- Delete: `app/client/src/agents/claude-code/icons.ts`
- Delete: `app/client/src/hooks/use-deduped-events.ts`

- [ ] **Step 1: Verify no remaining references**

For each file to delete, grep for imports:

```bash
grep -rn "from '@/lib/event-summary'" app/client/src --include="*.ts" --include="*.tsx"
grep -rn "from '@/config/event-icons'" app/client/src --include="*.ts" --include="*.tsx"
grep -rn "from '@/agents/claude-code/icons'" app/client/src --include="*.ts" --include="*.tsx"
grep -rn "from '@/hooks/use-deduped-events'" app/client/src --include="*.ts" --include="*.tsx"
```

Each should return zero matches. If any remain, those callers were missed in earlier tasks — fix them before deleting.

- [ ] **Step 2: Delete the files**

```bash
git rm app/client/src/lib/event-summary.ts app/client/src/lib/event-summary.test.ts \
       app/client/src/config/event-icons.ts app/client/src/agents/claude-code/icons.ts \
       app/client/src/hooks/use-deduped-events.ts
```

- [ ] **Step 3: Verify no orphaned helpers**

`claude-code/helpers.ts` had `getEventSummary`, `extractBashBinary`, `relativePath`, `oneLine`, `getToolSummary`, `buildSearchText`. After this round, `getEventSummary` is still called by `process-event.ts` (the in-claude-code call), so don't delete it. Just verify nothing else got orphaned:

```bash
grep -rn "getToolSummary\|extractBashBinary\|relativePath\|oneLine" app/client/src --include="*.ts" --include="*.tsx"
```

If any helper has zero callers, delete it too.

- [ ] **Step 4: Typecheck + tests**

```
just check
```

Expected: PASS, including the new `event-icon-registry.test.ts`. Total test count should drop slightly (event-summary tests deleted).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(client): delete legacy lib/event-summary, config/event-icons, claude-code/icons, use-deduped-events"
```

---

### Task 13: Audit pass — verify no agent-class imports from core

- [ ] **Step 1: Run the audit grep**

```bash
grep -rn "from '@/agents/claude-code\|from '@/agents/codex\|from '@/agents/default" \
  app/client/src --include="*.ts" --include="*.tsx" \
  | grep -v "^app/client/src/agents/" \
  | grep -v ".test."
```

Expected: **zero matches**. The only acceptable cross-references are within `app/client/src/agents/` (e.g., codex importing default's `processEvent`). No core file (under `lib/`, `components/`, `config/`, `hooks/`, `stores/`) should import from any agent-class lib.

If matches remain, add tasks to fix them before declaring complete.

- [ ] **Step 2: Run final check**

```
just check
```

Expected: PASS — all tests, lint, typecheck.

- [ ] **Step 3: Smoke test in dev**

```
just dev
```

Open the dashboard at the configured dev port. Verify:
- Sessions render with correct icons + colors (no missing/wrong icons).
- Tool rows show `Bash`/`Grep`/etc. with correct colors.
- Settings → Icons tab renders all groups (Tools, Session, User Input, Agents, Tasks, System, Compaction, MCP, Worktree). Customize an icon, confirm it renders in the event stream.
- Timeline rewind dots render with correct colors.
- Errors filter shows failed events.
- Console clean.

- [ ] **Step 4: Commit any final cleanup**

If the audit grep or smoke test surfaced anything, fix it and commit. Otherwise nothing to commit.

---

## Self-Review Checklist (before merge)

- [ ] `EVENT_ICON_REGISTRY` contains exactly the entries listed in Task 1 (no orphans, no missing groups).
- [ ] `EnrichedEvent` has `iconId: string`; no `icon`/`iconColor`/`dotColor`/`iconColorHex` fields.
- [ ] `AgentClassRegistration` has no `getEventIcon` / `getEventColor`.
- [ ] `processEvent` in claude-code, default, and codex sets `iconId`.
- [ ] `event-row.tsx`, `event-detail.tsx`, `dot-tooltip.tsx`, `timeline-rewind.tsx` resolve icon/color via `resolveEventIcon` / `resolveEventColor`.
- [ ] `icon-settings.tsx` iterates `EVENT_ICON_REGISTRY`.
- [ ] `config/filters.ts` has no `match()` callback field; uses `filterTags` + `status`.
- [ ] No file under `app/client/src/lib/`, `components/`, `config/`, `hooks/`, `stores/` imports from `@/agents/<class>/`.
- [ ] Deleted: `lib/event-summary.ts`, `lib/event-summary.test.ts`, `config/event-icons.ts`, `claude-code/icons.ts`, `hooks/use-deduped-events.ts`.
- [ ] localStorage migration runs once (gated by `MIGRATION_FLAG_KEY`).
- [ ] `just check` passes.
