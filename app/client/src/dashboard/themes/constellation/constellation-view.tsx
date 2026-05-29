import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useUIStore } from '@/stores/ui-store'
import { useNotificationStore } from '@/components/sidebar/notification-indicator'
import type { DashboardThemeProps } from '../../types'
import type { RecentSession } from '@/types'
import {
  WORLD_W,
  WORLD_H,
  radius,
  heat,
  layoutWells,
  stepSimulation,
  type SimNode,
  type Well,
} from './physics'
import { PALETTES, parseColor, resolvePaletteId, tempColor, type RGB } from './palettes'
import { DrillIn } from './drill-in'
import './constellation.css'

const PALETTE_STORAGE_KEY = 'agents-observe-constellation-palette'
const ZOOM_W = 560 // viewBox width when drilled into a session

interface NodeMeta {
  id: string
  slug: string
  projectKey: string
  projectName: string
  baseR: number
  orbitDots: number
  lastActivity: number
}

interface NodeEls {
  g: SVGGElement
  core: SVGCircleElement | null
  glow: SVGCircleElement | null
  pulseWrap: SVGGElement | null
  label: SVGTextElement | null
}

function projectKeyOf(s: RecentSession): string {
  return s.projectId != null ? `p${s.projectId}` : 'unassigned'
}

// Native palette RGBs as a safe default until the first getComputedStyle read.
const DEFAULT_RGB = { cool: [91, 107, 130], warm: [250, 204, 21], hot: [249, 115, 22] } as {
  cool: RGB
  warm: RGB
  hot: RGB
}

export function ConstellationView({ sessions, isLoading, onOpenSession }: DashboardThemeProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const drillLayerRef = useRef<SVGGElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)

  const [paletteId, setPaletteId] = useState(() =>
    resolvePaletteId(localStorage.getItem(PALETTE_STORAGE_KEY)),
  )
  const [reduced, setReduced] = useState(false)
  const [tau, setTau] = useState(90)
  const [focusedId, setFocusedId] = useState<string | null>(null)

  // Attention flags from the global notification store (pending && !dismissed).
  const pending = useNotificationStore((s) => s.pending)
  const dismissed = useNotificationStore((s) => s.dismissed)
  const flaggedSet = useMemo(() => {
    const set = new Set<string>()
    for (const id of pending.keys()) if (!dismissed.has(id)) set.add(id)
    return set
  }, [pending, dismissed])

  // Node descriptors derived from the session list.
  const nodes = useMemo<NodeMeta[]>(
    () =>
      sessions.map((s) => ({
        id: s.id,
        slug: s.slug || s.id.slice(0, 8),
        projectKey: projectKeyOf(s),
        projectName:
          s.projectName || (s.projectId == null ? 'Unassigned' : `project ${s.projectId}`),
        baseR: radius(s.eventCount),
        orbitDots: Math.min(Math.max((s.agentCount ?? 1) - 1, 0), 6),
        lastActivity: s.lastActivity,
      })),
    [sessions],
  )

  const wells = useMemo<Well[]>(() => {
    const keys: string[] = []
    const seen = new Set<string>()
    for (const n of nodes)
      if (!seen.has(n.projectKey)) {
        seen.add(n.projectKey)
        keys.push(n.projectKey)
      }
    return layoutWells(keys)
  }, [nodes])

  const wellNames = useMemo(() => {
    const m = new Map<string, string>()
    for (const n of nodes) if (!m.has(n.projectKey)) m.set(n.projectKey, n.projectName)
    return m
  }, [nodes])

  // ---- imperative state shared with the animation loop (no re-render) ----
  const simRef = useRef(new Map<string, SimNode>())
  const elRef = useRef(new Map<string, NodeEls>())
  const nodesRef = useRef<NodeMeta[]>([])
  const simListRef = useRef<SimNode[]>([])
  const orbitIdsRef = useRef(new Set<string>())
  const wellByKeyRef = useRef(new Map<string, Well>())
  const flaggedRef = useRef(flaggedSet)
  const focusedRef = useRef<string | null>(null)
  const paletteRgbRef = useRef(DEFAULT_RGB)
  const tauRef = useRef(tau)
  const vbRef = useRef<[number, number, number, number]>([0, 0, WORLD_W, WORLD_H])
  const targetVbRef = useRef<[number, number, number, number]>([0, 0, WORLD_W, WORLD_H])

  useEffect(() => {
    flaggedRef.current = flaggedSet
  }, [flaggedSet])
  useEffect(() => {
    tauRef.current = tau
  }, [tau])
  useEffect(() => {
    focusedRef.current = focusedId
  }, [focusedId])

  // Keep the sim map in sync with the node list: spawn new nodes near their
  // well center, drop departed ones.
  useEffect(() => {
    const wellByKey = new Map(wells.map((w) => [w.key, w]))
    wellByKeyRef.current = wellByKey
    const sim = simRef.current
    const live = new Set(nodes.map((n) => n.id))
    for (const id of [...sim.keys()]) if (!live.has(id)) sim.delete(id)
    for (const n of nodes) {
      if (!sim.has(n.id)) {
        const w = wellByKey.get(n.projectKey)
        const cx = w ? w.cx : WORLD_W / 2
        const cy = w ? w.cy : WORLD_H / 2
        sim.set(n.id, {
          id: n.id,
          x: cx + (Math.random() - 0.5) * 140,
          y: cy + (Math.random() - 0.5) * 140,
          vx: 0,
          vy: 0,
          projectKey: n.projectKey,
          baseR: n.baseR,
          heat: 0,
          attention: false,
        })
      } else {
        const s = sim.get(n.id)!
        s.projectKey = n.projectKey
        s.baseR = n.baseR
      }
    }
    nodesRef.current = nodes
    simListRef.current = nodes.map((n) => sim.get(n.id)!).filter(Boolean)
    orbitIdsRef.current = new Set(nodes.filter((n) => n.orbitDots > 0).map((n) => n.id))
  }, [nodes, wells])

  // Recompute cached palette RGBs whenever the palette changes.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const cs = getComputedStyle(el)
    const read = (name: string, fallback: RGB): RGB => {
      const v = cs.getPropertyValue(name).trim()
      return v ? parseColor(v) : fallback
    }
    paletteRgbRef.current = {
      cool: read('--c-cool', DEFAULT_RGB.cool),
      warm: read('--c-warm', DEFAULT_RGB.warm),
      hot: read('--c-hot', DEFAULT_RGB.hot),
    }
  }, [paletteId])

  // Register a node group's elements (cheap querySelector on mount/structure change).
  const registerNode = useCallback((id: string, g: SVGGElement | null) => {
    if (!g) {
      elRef.current.delete(id)
      return
    }
    elRef.current.set(id, {
      g,
      core: g.querySelector('.cst-core'),
      glow: g.querySelector('.cst-glow'),
      pulseWrap: g.querySelector('.cst-pulse-wrap'),
      label: g.querySelector('.cst-label'),
    })
  }, [])

  // ---- the animation loop ----
  useEffect(() => {
    let raf = 0
    const hasOrbit = (n: SimNode) => orbitIdsRef.current.has(n.id)

    const frame = () => {
      const now = Date.now()
      const activityAt = useUIStore.getState().sessionActivityAt
      const flagged = flaggedRef.current
      const { cool, warm, hot } = paletteRgbRef.current
      const tauSec = tauRef.current
      const metas = nodesRef.current
      const sim = simRef.current

      for (const m of metas) {
        const s = sim.get(m.id)
        if (!s) continue
        s.heat = heat(activityAt[m.id] ?? m.lastActivity, now, tauSec)
        s.attention = flagged.has(m.id)
      }

      if (!focusedRef.current) {
        stepSimulation(simListRef.current, wellByKeyRef.current, hasOrbit)
      }

      // viewBox easing
      const vb = vbRef.current
      const tvb = targetVbRef.current
      let moved = false
      for (let i = 0; i < 4; i++) {
        const d = tvb[i] - vb[i]
        if (Math.abs(d) > 0.5) {
          vb[i] += d * 0.14
          moved = true
        } else vb[i] = tvb[i]
      }
      if (moved && svgRef.current) svgRef.current.setAttribute('viewBox', vb.join(' '))

      for (const m of metas) {
        const s = sim.get(m.id)
        const els = elRef.current.get(m.id)
        if (!s || !els) continue
        const h = s.heat
        const col = tempColor(h, cool, warm, hot)
        const r = m.baseR * (0.82 + 0.18 * h)
        els.g.style.transform = `translate(${s.x}px, ${s.y}px)`
        els.g.style.opacity = s.attention ? '1' : (0.2 + 0.8 * h).toFixed(3)
        if (els.core) {
          els.core.setAttribute('r', r.toFixed(2))
          els.core.setAttribute('fill', col)
          els.core.style.filter =
            h > 0.06 ? `drop-shadow(0 0 ${(m.baseR * 0.7 * h).toFixed(1)}px ${col})` : 'none'
        }
        if (els.glow) {
          els.glow.setAttribute('fill', col)
          els.glow.style.opacity = (0.5 * h).toFixed(3)
        }
        if (els.pulseWrap) els.pulseWrap.style.opacity = Math.max(0, h - 0.06).toFixed(3)
        if (els.label) els.label.style.opacity = (0.28 + 0.55 * h).toFixed(3)
      }

      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])

  // ---- interactions ----
  const showTooltip = (e: React.MouseEvent, m: NodeMeta) => {
    const t = tooltipRef.current
    if (!t) return
    const flagged = flaggedRef.current.has(m.id)
    t.style.opacity = '1'
    t.style.left = `${e.clientX}px`
    t.style.top = `${e.clientY + 16}px`
    t.innerHTML =
      `<div class="cst-tt-slug">${m.slug}</div>` +
      `<div class="cst-tt-row"><span>project</span><b>${m.projectName}</b></div>` +
      `<div class="cst-tt-row"><span>subagents</span><b>${m.orbitDots}</b></div>` +
      (flagged ? `<div class="cst-tt-attn">● needs attention</div>` : '')
  }
  const hideTooltip = () => {
    if (tooltipRef.current) tooltipRef.current.style.opacity = '0'
  }

  const focus = (id: string) => {
    const s = simRef.current.get(id)
    if (!s) return
    const zh = (ZOOM_W * WORLD_H) / WORLD_W
    targetVbRef.current = [s.x - ZOOM_W / 2, s.y - zh / 2, ZOOM_W, zh]
    setFocusedId(id)
    hideTooltip()
    // Mirror the focus into the sidebar (expand project + highlight session)
    // without navigating away from the constellation.
    const sess = sessions.find((x) => x.id === id)
    useUIStore.getState().setPreviewSession(id, sess?.projectId ?? null)
  }
  const unfocus = useCallback(() => {
    targetVbRef.current = [0, 0, WORLD_W, WORLD_H]
    setFocusedId(null)
    useUIStore.getState().clearPreviewSession()
  }, [])

  // Drop the sidebar preview if the constellation unmounts while focused
  // (e.g. switching dashboard theme, or navigating into a session).
  useEffect(() => () => useUIStore.getState().clearPreviewSession(), [])

  const focusedSim = focusedId ? simRef.current.get(focusedId) : null

  const selectPalette = (id: string) => {
    setPaletteId(id)
    localStorage.setItem(PALETTE_STORAGE_KEY, id)
  }

  if (!isLoading && sessions.length === 0) {
    return (
      <div className="constellation flex items-center justify-center" data-palette={paletteId}>
        <div className="text-sm" style={{ color: 'var(--c-muted)' }}>
          No sessions yet — they'll appear here as agents connect.
        </div>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      data-palette={paletteId}
      className={
        'constellation' +
        (focusedId ? ' constellation--focused' : '') +
        (reduced ? ' constellation--reduced' : '')
      }
    >
      <svg
        ref={svgRef}
        className="constellation__svg"
        viewBox={`0 0 ${WORLD_W} ${WORLD_H}`}
        preserveAspectRatio="xMidYMid slice"
        onClick={() => focusedId && unfocus()}
      >
        <g className="cst-field">
          {wells.map((w) => (
            <g key={w.key}>
              <circle className="cst-well" cx={w.cx} cy={w.cy} r={w.r} />
              <circle className="cst-well-ring" cx={w.cx} cy={w.cy} r={w.r} />
              <text className="cst-well-label" x={w.cx} y={w.cy - w.r - 10}>
                {wellNames.get(w.key)}
              </text>
            </g>
          ))}
          {nodes.map((m) => {
            const orbitR = m.baseR + 16
            const flagged = flaggedSet.has(m.id)
            return (
              <g
                key={m.id}
                ref={(g) => registerNode(m.id, g)}
                className={'cst-star' + (focusedId === m.id ? ' cst-star--focused' : '')}
                onMouseMove={(e) => !focusedId && showTooltip(e, m)}
                onMouseLeave={hideTooltip}
                onClick={(e) => {
                  e.stopPropagation()
                  focus(m.id)
                }}
              >
                <g className="cst-pulse-wrap" style={{ opacity: 0 }}>
                  <circle className="cst-pulse" cx={0} cy={0} r={12} />
                </g>
                <circle
                  className="cst-glow"
                  cx={0}
                  cy={0}
                  r={m.baseR * 1.5}
                  style={{ filter: 'blur(6px)', opacity: 0 }}
                  fill="var(--c-cool)"
                />
                {m.orbitDots > 0 && (
                  <>
                    <circle className="cst-orbit-path" cx={0} cy={0} r={orbitR} />
                    <g
                      className="cst-orbit"
                      style={{ animationDuration: `${11 + m.orbitDots * 3}s` }}
                    >
                      {Array.from({ length: m.orbitDots }).map((_, i) => {
                        const a = (i / m.orbitDots) * Math.PI * 2
                        const sx = Math.cos(a) * orbitR
                        const sy = Math.sin(a) * orbitR
                        return (
                          <g key={i}>
                            <line className="cst-edge" x1={0} y1={0} x2={sx} y2={sy} />
                            <circle
                              className="cst-sub"
                              cx={sx}
                              cy={sy}
                              r={4.5}
                              fill="var(--c-warm)"
                            />
                          </g>
                        )
                      })}
                    </g>
                  </>
                )}
                <circle className="cst-core" cx={0} cy={0} r={m.baseR} fill="var(--c-cool)" />
                {flagged && (
                  <>
                    <circle className="cst-flare" cx={0} cy={0} r={15} />
                    <circle className="cst-flare cst-flare--b" cx={0} cy={0} r={15} />
                  </>
                )}
                <text className="cst-label" x={0} y={m.baseR + 13}>
                  {m.slug}
                </text>
              </g>
            )
          })}
        </g>
        <g ref={drillLayerRef} className={'cst-drill' + (focusedId ? ' cst-drill--show' : '')} />
      </svg>

      {focusedId && focusedSim && (
        <DrillIn
          key={focusedId}
          sessionId={focusedId}
          slug={nodes.find((n) => n.id === focusedId)?.slug ?? focusedId.slice(0, 8)}
          originX={focusedSim.x}
          originY={focusedSim.y}
          portalTarget={drillLayerRef.current}
          onClose={unfocus}
          onOpen={() => {
            const s = sessions.find((x) => x.id === focusedId)
            if (s) {
              useUIStore.getState().clearPreviewSession()
              onOpenSession(s)
            }
          }}
        />
      )}

      <ConstellationControls
        paletteId={paletteId}
        onPalette={selectPalette}
        reduced={reduced}
        onReduced={setReduced}
        tau={tau}
        onTau={setTau}
      />

      <div className="cst-tooltip" ref={tooltipRef} />
    </div>
  )
}

interface ControlsProps {
  paletteId: string
  onPalette: (id: string) => void
  reduced: boolean
  onReduced: (v: boolean) => void
  tau: number
  onTau: (v: number) => void
}

function ConstellationControls({
  paletteId,
  onPalette,
  reduced,
  onReduced,
  tau,
  onTau,
}: ControlsProps) {
  return (
    <div className="cst-panel cst-controls">
      <div className="cst-panel-h">Palette</div>
      <div className="cst-row">
        {PALETTES.map((p) => (
          <button
            key={p.id}
            className={'cst-btn' + (p.id === paletteId ? ' cst-btn--on' : '')}
            onClick={() => onPalette(p.id)}
          >
            {p.name}
          </button>
        ))}
      </div>
      <div className="cst-row cst-row--center">
        <label htmlFor="cst-tau">decay τ</label>
        <input
          id="cst-tau"
          type="range"
          min={15}
          max={300}
          value={tau}
          onChange={(e) => onTau(Number(e.target.value))}
        />
        <span className="cst-tau-val">{tau}s</span>
      </div>
      <div className="cst-row">
        <button
          className={'cst-btn' + (reduced ? ' cst-btn--on' : '')}
          onClick={() => onReduced(!reduced)}
        >
          Reduce motion
        </button>
      </div>
    </div>
  )
}
