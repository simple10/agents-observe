import { useMemo } from 'react'
import { useUIStore } from '@/stores/ui-store'
import { useEvents } from '@/hooks/use-events'
import { cn } from '@/lib/utils'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { STATIC_FILTERS, getDynamicFilterNames, getDynamicDisplayName, getFiltersWithMatches } from '@/config/filters'

export function EventFilterBar() {
  const {
    activeStaticFilters,
    activeToolFilters,
    toggleStaticFilter,
    toggleToolFilter,
    clearAllFilters,
    searchQuery,
    setSearchQuery,
    selectedSessionId,
    selectedAgentIds,
  } = useUIStore()

  const { data: events } = useEvents(selectedSessionId)

  const agentFilteredEvents = useMemo(() => {
    if (!events) return []
    return selectedAgentIds.length > 0
      ? events.filter((e) => selectedAgentIds.includes(e.agentId))
      : events
  }, [events, selectedAgentIds])

  const dynamicNames = useMemo(() => getDynamicFilterNames(agentFilteredEvents), [agentFilteredEvents])
  const filtersWithMatches = useMemo(() => getFiltersWithMatches(agentFilteredEvents), [agentFilteredEvents])

  const hasAnyFilter = activeStaticFilters.length > 0 || activeToolFilters.length > 0

  return (
    <div className="flex flex-col gap-1 px-3 py-1.5 border-b border-border">
      {/* Row 1: Static filters + search */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-xs text-muted-foreground">Filters:</span>
          <button
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
          {STATIC_FILTERS.map((filter) => {
            const isActive = activeStaticFilters.includes(filter.label)
            const hasMatches = filtersWithMatches.has(filter.label)
            return (
              <button
                key={filter.label}
                className={cn(
                  'rounded-full px-2.5 py-0.5 text-xs transition-colors border',
                  isActive
                    ? 'bg-primary text-primary-foreground border-primary'
                    : hasMatches
                      ? 'bg-secondary text-secondary-foreground border-primary/40 hover:bg-accent'
                      : 'bg-secondary text-muted-foreground/70 dark:text-muted-foreground/50 border-transparent hover:bg-accent hover:text-secondary-foreground',
                )}
                onClick={() => toggleStaticFilter(filter.label)}
              >
                {filter.label}
              </button>
            )
          })}
        </div>

        <div className="flex-1" />

        <div className="relative w-48">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search events..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-7 pl-7 text-xs"
          />
        </div>
      </div>

      {/* Row 2: Dynamic tool filters */}
      {dynamicNames.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          {dynamicNames.map((name) => (
            <button
              key={name}
              className={cn(
                'rounded-full px-2.5 py-0.5 text-xs transition-colors border',
                activeToolFilters.includes(name)
                  ? 'border-blue-500 bg-blue-500/15 text-blue-700 dark:text-blue-400'
                  : 'border-border text-muted-foreground hover:border-blue-500/50 hover:text-foreground',
              )}
              onClick={() => toggleToolFilter(name)}
            >
              {getDynamicDisplayName(name)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
