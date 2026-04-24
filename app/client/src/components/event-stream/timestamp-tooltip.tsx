import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { format as timeago } from 'timeago.js'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

type TooltipCallbacks = {
  show: (timestamp: number, rect: DOMRect) => void
  hide: () => void
}

const NOOP: TooltipCallbacks = { show: () => {}, hide: () => {} }
const TimestampTooltipContext = createContext<TooltipCallbacks>(NOOP)

export function useTimestampTooltip(): TooltipCallbacks {
  return useContext(TimestampTooltipContext)
}

function formatFullDate(ts: number): string {
  const d = new Date(ts)
  const weekday = d.toLocaleDateString('en-US', { weekday: 'short' })
  const month = d.toLocaleDateString('en-US', { month: 'long' })
  const day = d.getDate()
  const year = d.getFullYear()
  const time = d.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  return `${weekday} ${month} ${day}, ${year} ${time}`
}

/**
 * Shared tooltip for event-row timestamps. One Radix Tooltip instance
 * for the whole list — EventRows call `show`/`hide` on mouseenter/leave
 * and the invisible anchor span is repositioned via fixed coordinates.
 *
 * `show`/`hide` are stable across renders so EventRow's React.memo
 * stays effective. Hover-state changes only re-render this provider,
 * not any EventRow.
 */
export function TimestampTooltipProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ timestamp: number; rect: DOMRect } | null>(null)

  const show = useCallback((timestamp: number, rect: DOMRect) => {
    setState({ timestamp, rect })
  }, [])
  const hide = useCallback(() => setState(null), [])

  const value = useMemo(() => ({ show, hide }), [show, hide])

  return (
    <TimestampTooltipContext.Provider value={value}>
      {children}
      <Tooltip open={state !== null}>
        <TooltipTrigger asChild>
          <span
            aria-hidden
            className="pointer-events-none block"
            style={{
              position: 'fixed',
              top: state ? state.rect.top : 0,
              left: state ? state.rect.left : 0,
              width: state ? state.rect.width : 0,
              height: state ? state.rect.height : 0,
            }}
          />
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {state && (
            <div className="flex flex-col gap-0.5">
              <span>{formatFullDate(state.timestamp)}</span>
              <span className="text-muted-foreground">{timeago(state.timestamp)}</span>
            </div>
          )}
        </TooltipContent>
      </Tooltip>
    </TimestampTooltipContext.Provider>
  )
}
