import { useSyncExternalStore, useCallback } from 'react'

const STORAGE_KEY = 'observe-icon-customizations'

export interface IconCustomization {
  iconName?: string // lucide-react PascalCase icon name
  colorName?: string // color preset key (e.g. "blue", "red", "green") or "custom"
  customHex?: string // hex color when colorName is "custom" (e.g. "#ff5500")
}

export type IconCustomizations = Record<string, IconCustomization>

// Color presets: each defines a text class for stream icons and a bg class for timeline dots
export const COLOR_PRESETS: Record<string, { label: string; iconColor: string; dotColor: string; swatch: string }> = {
  red: {
    label: 'Red',
    iconColor: 'text-red-600 dark:text-red-400',
    dotColor: 'bg-red-600 dark:bg-red-500',
    swatch: '#dc2626',
  },
  orange: {
    label: 'Orange',
    iconColor: 'text-orange-600 dark:text-orange-400',
    dotColor: 'bg-orange-600 dark:bg-orange-500',
    swatch: '#ea580c',
  },
  amber: {
    label: 'Amber',
    iconColor: 'text-amber-600 dark:text-amber-400',
    dotColor: 'bg-amber-600 dark:bg-amber-500',
    swatch: '#d97706',
  },
  yellow: {
    label: 'Yellow',
    iconColor: 'text-yellow-600 dark:text-yellow-400',
    dotColor: 'bg-yellow-600 dark:bg-yellow-500',
    swatch: '#ca8a04',
  },
  lime: {
    label: 'Lime',
    iconColor: 'text-lime-600 dark:text-lime-400',
    dotColor: 'bg-lime-600 dark:bg-lime-500',
    swatch: '#65a30d',
  },
  green: {
    label: 'Green',
    iconColor: 'text-green-600 dark:text-green-400',
    dotColor: 'bg-green-600 dark:bg-green-500',
    swatch: '#16a34a',
  },
  emerald: {
    label: 'Emerald',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
    dotColor: 'bg-emerald-600 dark:bg-emerald-500',
    swatch: '#059669',
  },
  teal: {
    label: 'Teal',
    iconColor: 'text-teal-600 dark:text-teal-400',
    dotColor: 'bg-teal-600 dark:bg-teal-500',
    swatch: '#0d9488',
  },
  cyan: {
    label: 'Cyan',
    iconColor: 'text-cyan-600 dark:text-cyan-400',
    dotColor: 'bg-cyan-600 dark:bg-cyan-500',
    swatch: '#0891b2',
  },
  sky: {
    label: 'Sky',
    iconColor: 'text-sky-600 dark:text-sky-400',
    dotColor: 'bg-sky-600 dark:bg-sky-500',
    swatch: '#0284c7',
  },
  blue: {
    label: 'Blue',
    iconColor: 'text-blue-600 dark:text-blue-400',
    dotColor: 'bg-blue-600 dark:bg-blue-500',
    swatch: '#2563eb',
  },
  indigo: {
    label: 'Indigo',
    iconColor: 'text-indigo-600 dark:text-indigo-400',
    dotColor: 'bg-indigo-600 dark:bg-indigo-500',
    swatch: '#4f46e5',
  },
  violet: {
    label: 'Violet',
    iconColor: 'text-violet-600 dark:text-violet-400',
    dotColor: 'bg-violet-600 dark:bg-violet-500',
    swatch: '#7c3aed',
  },
  purple: {
    label: 'Purple',
    iconColor: 'text-purple-600 dark:text-purple-400',
    dotColor: 'bg-purple-600 dark:bg-purple-500',
    swatch: '#9333ea',
  },
  fuchsia: {
    label: 'Fuchsia',
    iconColor: 'text-fuchsia-600 dark:text-fuchsia-400',
    dotColor: 'bg-fuchsia-600 dark:bg-fuchsia-500',
    swatch: '#c026d3',
  },
  pink: {
    label: 'Pink',
    iconColor: 'text-pink-600 dark:text-pink-400',
    dotColor: 'bg-pink-600 dark:bg-pink-500',
    swatch: '#db2777',
  },
  rose: {
    label: 'Rose',
    iconColor: 'text-rose-600 dark:text-rose-400',
    dotColor: 'bg-rose-600 dark:bg-rose-500',
    swatch: '#e11d48',
  },
  slate: {
    label: 'Slate',
    iconColor: 'text-slate-600 dark:text-slate-400',
    dotColor: 'bg-slate-600 dark:bg-slate-500',
    swatch: '#475569',
  },
  gray: {
    label: 'Gray',
    iconColor: 'text-gray-500 dark:text-gray-400',
    dotColor: 'bg-gray-500 dark:bg-gray-400',
    swatch: '#6b7280',
  },
}

// --- External store for cross-component reactivity ---

let cachedCustomizations: IconCustomizations | null = null

function getCustomizations(): IconCustomizations {
  if (cachedCustomizations !== null) return cachedCustomizations
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    cachedCustomizations = raw ? JSON.parse(raw) : {}
  } catch {
    cachedCustomizations = {}
  }
  return cachedCustomizations!
}

function saveCustomizations(customizations: IconCustomizations) {
  cachedCustomizations = customizations
  localStorage.setItem(STORAGE_KEY, JSON.stringify(customizations))
  notifyListeners()
}

// Snapshot-based subscriptions for useSyncExternalStore
type Listener = () => void
const listeners = new Set<Listener>()
let snapshot = getCustomizations()

function notifyListeners() {
  snapshot = { ...getCustomizations() }
  for (const listener of listeners) listener()
}

function subscribe(listener: Listener) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function getSnapshot(): IconCustomizations {
  return snapshot
}

// --- Public API ---

/**
 * React hook that provides icon customizations with reactive updates.
 */
export function useIconCustomizations() {
  const customizations = useSyncExternalStore(subscribe, getSnapshot)

  const setCustomization = useCallback((eventKey: string, update: IconCustomization) => {
    const current = getCustomizations()
    const existing = current[eventKey] || {}
    const merged = { ...existing, ...update }

    // Remove keys that are undefined
    if (!merged.iconName) delete merged.iconName
    if (!merged.colorName) delete merged.colorName

    const next = { ...current }
    if (Object.keys(merged).length === 0) {
      delete next[eventKey]
    } else {
      next[eventKey] = merged
    }
    saveCustomizations(next)
  }, [])

  const resetCustomization = useCallback((eventKey: string) => {
    const current = getCustomizations()
    const next = { ...current }
    delete next[eventKey]
    saveCustomizations(next)
  }, [])

  const resetAll = useCallback(() => {
    saveCustomizations({})
  }, [])

  return { customizations, setCustomization, resetCustomization, resetAll }
}

/**
 * Non-reactive getter for use in getEventIcon/getEventColor (called very frequently).
 * Reads from cache, no React dependency.
 */
export function getIconCustomization(eventKey: string): IconCustomization | undefined {
  return getCustomizations()[eventKey]
}
