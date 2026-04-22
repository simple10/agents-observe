import { useMemo, useState, useEffect, useRef } from 'react'
import { useUIStore } from '@/stores/ui-store'
import { useProcessedEvents } from '@/agents/event-processing-context'
import { cn } from '@/lib/utils'
import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { focusSiblingMatching } from '@/lib/keyboard-nav'

// Framework-defined static filter categories (always shown in this order)
const STATIC_CATEGORIES = [
  'Prompts',
  'Tools',
  'Agents',
  'Tasks',
  'Session',
  'MCP',
  'Permissions',
  'Notifications',
  'Stop',
  'Compaction',
  'Errors',
  'Config',
]

export function EventFilterBar() {
  const {
    activeStaticFilters,
    activeToolFilters,
    toggleStaticFilter,
    toggleToolFilter,
    clearAllFilters,
    searchQuery,
    setSearchQuery,
    selectedAgentIds,
  } = useUIStore()

  // Local input state for responsive typing; debounce before updating the store
  const [localSearch, setLocalSearch] = useState(searchQuery)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    setLocalSearch(searchQuery)
  }, [searchQuery])

  function handleSearchChange(value: string) {
    setLocalSearch(value)
    clearTimeout(debounceRef.current)
    if (value === '') {
      setSearchQuery('')
    } else {
      debounceRef.current = setTimeout(() => setSearchQuery(value), 350)
    }
  }

  const { events: enrichedEvents } = useProcessedEvents()

  // Only consider displayed events for filter state
  const displayedEvents = useMemo(
    () => enrichedEvents.filter((e) => e.displayEventStream),
    [enrichedEvents],
  )

  // Apply agent selection filter before computing available filters
  const agentFilteredEvents = useMemo(
    () =>
      selectedAgentIds.length > 0
        ? displayedEvents.filter((e) => selectedAgentIds.includes(e.agentId))
        : displayedEvents,
    [displayedEvents, selectedAgentIds],
  )

  // Which static categories have at least one event
  const activeCategories = useMemo(() => {
    const cats = new Set<string>()
    for (const e of agentFilteredEvents) {
      if (e.filterTags.static) cats.add(e.filterTags.static)
      // 'Errors' is cross-cutting — check status and payload
      if (e.status === 'failed' || (e.payload as any)?.error) cats.add('Errors')
    }
    return cats
  }, [agentFilteredEvents])

  // Collect all unique dynamic filter names
  const dynamicNames = useMemo(() => {
    const names = new Set<string>()
    for (const e of agentFilteredEvents) {
      for (const tag of e.filterTags.dynamic) {
        names.add(tag)
      }
    }
    return Array.from(names).sort()
  }, [agentFilteredEvents])

  const hasAnyFilter = activeStaticFilters.length > 0 || activeToolFilters.length > 0

  return (
    <div
      className="flex flex-col gap-1 px-3 py-1.5 border-b border-border"
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
        const direction = e.key === 'ArrowRight' ? 1 : -1
        const target = e.target as HTMLElement
        if (!target.matches('[data-filter-pill]')) return
        if (focusSiblingMatching(target, '[data-filter-pill]', e.currentTarget, direction)) {
          e.preventDefault()
        }
      }}
    >
      {/* Row 1: Static category filters + search */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-xs text-muted-foreground">Filters:</span>
          <button
            data-filter-pill=""
            className={cn(
              'rounded-full px-2.5 py-0.5 text-xs transition-colors',
              !hasAnyFilter
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-secondary-foreground hover:bg-accent',
            )}
            onClick={clearAllFilters}
          >
            All
          </button>
          {STATIC_CATEGORIES.map((category) => {
            const isActive = activeStaticFilters.includes(category)
            const hasMatches = activeCategories.has(category)
            return (
              <button
                key={category}
                data-filter-pill=""
                className={cn(
                  'rounded-full px-2.5 py-0.5 text-xs transition-colors border',
                  isActive
                    ? 'bg-primary text-primary-foreground border-primary'
                    : hasMatches
                      ? 'bg-secondary text-secondary-foreground border-primary/40 hover:bg-accent'
                      : 'bg-secondary text-muted-foreground/70 dark:text-muted-foreground/50 border-transparent hover:bg-accent hover:text-secondary-foreground',
                )}
                onClick={() => toggleStaticFilter(category)}
              >
                {category}
              </button>
            )
          })}
        </div>

        <div className="flex-1" />

        <div className="relative w-48">
          <Search
            className={cn(
              'absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5',
              localSearch ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground',
            )}
          />
          <Input
            placeholder="Search events..."
            value={localSearch}
            onChange={(e) => handleSearchChange(e.target.value)}
            className={cn(
              'h-7 pl-7 text-xs',
              localSearch &&
                'border-green-600 dark:border-green-400 ring-1 ring-green-600/30 dark:ring-green-400/30',
              localSearch &&
                localSearch !== localSearch.trim() &&
                'bg-green-600/5 dark:bg-green-400/5',
              localSearch && 'pr-7',
            )}
          />
          {localSearch && (
            <button
              onClick={() => handleSearchChange('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 h-4 w-4 flex items-center justify-center rounded-sm text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Row 2: Dynamic tool filters */}
      {dynamicNames.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          {dynamicNames.map((name) => (
            <button
              key={name}
              data-filter-pill=""
              className={cn(
                'rounded-full px-2.5 py-0.5 text-xs transition-colors border',
                activeToolFilters.includes(name)
                  ? 'border-blue-500 bg-blue-500/15 text-blue-700 dark:text-blue-400'
                  : 'border-border text-muted-foreground hover:border-blue-500/50 hover:text-foreground',
              )}
              onClick={() => toggleToolFilter(name)}
            >
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
