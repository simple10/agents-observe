import { useMemo } from 'react'
import type { ParsedEvent } from '@/types'

interface EventTickerProps {
  events: ParsedEvent[] | undefined
  loading: boolean
}

const MAX_ROWS = 14

function fmtTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function shortenPath(path: string): string {
  const cleaned = path.replace(/^\/(?:Users|home)\/[^/]+/, '~')
  const parts = cleaned.split('/')
  return parts.length > 3 ? `…/${parts.slice(-2).join('/')}` : cleaned
}

function describe(e: ParsedEvent): { tool: string; summary: string } {
  const p = (e.payload ?? {}) as Record<string, unknown>
  const tool = (typeof p.tool_name === 'string' && p.tool_name) || e.hookName
  const ti = (p.tool_input ?? {}) as Record<string, unknown>
  let summary = ''
  if (typeof ti.command === 'string') summary = ti.command
  else if (typeof ti.file_path === 'string') summary = shortenPath(ti.file_path)
  else if (typeof ti.pattern === 'string') summary = ti.pattern
  else if (typeof ti.path === 'string') summary = shortenPath(ti.path)
  else if (typeof p.prompt === 'string') summary = p.prompt
  else summary = e.hookName
  return { tool, summary: summary.replace(/\s+/g, ' ').slice(0, 90) }
}

/** Live-ish event feed for the focused session (newest at the bottom). */
export function EventTicker({ events, loading }: EventTickerProps) {
  // Newest first → with column-reverse layout the latest row sits at the bottom.
  const rows = useMemo(() => {
    if (!events) return []
    return [...events].sort((a, b) => b.timestamp - a.timestamp).slice(0, MAX_ROWS)
  }, [events])

  return (
    <div className="cst-panel cst-ticker">
      <div className="cst-ticker-h">
        <b>recent events</b>
        <span className="cst-ticker-live">live</span>
      </div>
      <div className="cst-ticker-feed">
        {rows.length === 0 ? (
          <div className="cst-ticker-empty">{loading ? 'Loading events…' : 'No events yet.'}</div>
        ) : (
          rows.map((e) => {
            const { tool, summary } = describe(e)
            return (
              <div className="cst-ev" key={e.id}>
                <span className="cst-ev-ts">{fmtTime(e.timestamp)}</span>
                <span className="cst-ev-sum">{summary}</span>
                <span className="cst-ev-tool">{tool}</span>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
