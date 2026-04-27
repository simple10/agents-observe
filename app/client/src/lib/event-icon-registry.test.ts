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

  // Note: user color override behavior (preset / custom hex) is integration-
  // tested via the icon-settings UI, not here. The cache in
  // `use-icon-customizations` is module-level state and not cleanly resettable
  // between unit tests, so isolated assertions on override semantics would be
  // flaky.

  test('falls back to Default color for an unknown id', () => {
    const got = resolveEventColor('SomeFutureId')
    expect(got.iconColor).toBe(EVENT_ICON_REGISTRY.Default.defaultColor.iconColor)
  })
})
