import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

/**
 * Bordered section with a compact preview and an expand-in-place
 * "View details ▾" row at the bottom. Internal expand state, no
 * global store.
 */
export function CollapsibleSection({
  title,
  preview,
  details,
}: {
  title: string
  preview: ReactNode
  details: ReactNode | null
}) {
  const [expanded, setExpanded] = useState(false)
  const hasDetails = details != null
  return (
    <div className="rounded-md border border-border mb-5 overflow-hidden">
      <div className="px-4 py-3">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
          {title}
        </div>
        {preview}
        {expanded && hasDetails && <div className="mt-3">{details}</div>}
      </div>
      {hasDetails && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="w-full border-t border-border/60 py-1.5 text-[11px] text-muted-foreground hover:text-amber-500 hover:bg-muted/30 transition-colors flex items-center justify-center gap-1"
        >
          {expanded ? 'Hide details' : 'View details'}
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
      )}
    </div>
  )
}
