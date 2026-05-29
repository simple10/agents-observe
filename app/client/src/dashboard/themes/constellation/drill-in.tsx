import { useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useEvents } from '@/hooks/use-events'
import { useAgents } from '@/hooks/use-agents'
import { useUIStore } from '@/stores/ui-store'
import { buildAgentTree, layoutTree } from './agent-tree'
import { EventTicker } from './event-ticker'

interface DrillInProps {
  sessionId: string
  slug: string
  originX: number
  originY: number
  /** The <g> inside the constellation <svg> to portal the tree into. */
  portalTarget: SVGGElement | null
  onClose: () => void
  onOpen: () => void
}

/**
 * Drill-in overlay for a focused session: the subagent tree (rendered via a
 * portal into the constellation's SVG so it shares the zoomed coordinate
 * space) plus HTML controls and a recent-events ticker. Mounted only while a
 * session is focused; lazily loads that session's events + agents.
 */
export function DrillIn({
  sessionId,
  slug,
  originX,
  originY,
  portalTarget,
  onClose,
  onOpen,
}: DrillInProps) {
  const queryClient = useQueryClient()
  const { data: events, isLoading } = useEvents(sessionId)
  const agents = useAgents(sessionId, events)
  const pulse = useUIStore((s) => s.sessionPulses[sessionId] ?? 0)

  // Refetch this session's events whenever it receives an activity ping, so
  // the tree status + ticker stay near-live without a dedicated WS subscription.
  useEffect(() => {
    if (pulse > 0) queryClient.invalidateQueries({ queryKey: ['events', sessionId] })
  }, [pulse, sessionId, queryClient])

  const layout = useMemo(() => {
    const tree = buildAgentTree(agents, sessionId)
    if (!tree.name) tree.name = slug
    return layoutTree(tree, originX, originY)
  }, [agents, sessionId, slug, originX, originY])

  const treeSvg = (
    <g>
      {layout.edges.map((e, i) => (
        <line key={i} className="cst-tree-edge" x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} />
      ))}
      {layout.nodes.map((n) => {
        const r = n.isRoot ? 11 : n.depth === 1 ? 7 : 5.5
        const fill = n.isRoot
          ? 'var(--c-warm)'
          : n.status === 'active'
            ? 'var(--c-ok)'
            : 'var(--c-stopped)'
        return (
          <g
            key={n.id}
            // The root node IS the session — clicking it opens the full view.
            // (.cst-drill has pointer-events:none; .cst-tree-root re-enables it.)
            className={n.isRoot ? 'cst-tree-root' : undefined}
            onClick={n.isRoot ? onOpen : undefined}
          >
            {n.isRoot && <title>Open session</title>}
            <circle
              className="cst-tree-node"
              cx={n.x}
              cy={n.y}
              r={r}
              fill={fill}
              style={n.status === 'active' ? { filter: `drop-shadow(0 0 6px ${fill})` } : undefined}
            />
            <text className="cst-tree-label" x={n.x} y={n.y - r - 4}>
              {n.name || n.id.slice(0, 8)}
            </text>
            {!n.isRoot && n.type && (
              <text className="cst-tree-type" x={n.x} y={n.y + r + 9}>
                {n.type}
              </text>
            )}
          </g>
        )
      })}
    </g>
  )

  return (
    <>
      {portalTarget && createPortal(treeSvg, portalTarget)}
      <div className="cst-drill-actions">
        <button className="cst-btn" onClick={onClose}>
          ← Back
        </button>
        <button className="cst-btn cst-btn--on" onClick={onOpen}>
          Open session →
        </button>
      </div>
      <EventTicker events={events} loading={isLoading} />
    </>
  )
}
