import { useState, useMemo, useEffect } from 'react'
import { ALL_ICON_NAMES, DynamicIcon, toPascalCase } from '@/lib/dynamic-icon'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface IconPickerProps {
  currentIconName: string
  iconColorClass: string
  iconStyle?: React.CSSProperties
  onSelect: (iconName: string) => void
}

// Limit visible icons for performance — no virtualization needed with this cap
const MAX_VISIBLE = 300

export function IconPicker({
  currentIconName,
  iconColorClass,
  iconStyle,
  onSelect,
}: IconPickerProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  // When the picker is open, prevent scrolling on the modal behind it
  useEffect(() => {
    if (!open) return
    const handler = (e: WheelEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-slot="popover-content"]')) {
        e.preventDefault()
      }
    }
    document.addEventListener('wheel', handler, { passive: false })
    return () => document.removeEventListener('wheel', handler)
  }, [open])

  const filtered = useMemo(() => {
    if (!search) return ALL_ICON_NAMES
    const lower = search.toLowerCase()
    return ALL_ICON_NAMES.filter((name) => name.includes(lower))
  }, [search])

  // Convert currentIconName (PascalCase) to kebab-case for comparison
  const currentKebab = currentIconName
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase()

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (!v) setSearch('')
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon-sm" className="shrink-0" aria-label="Change icon">
          <DynamicIcon
            name={currentKebab}
            className={cn('h-4 w-4', iconColorClass)}
            style={iconStyle}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-72 p-0"
        align="start"
        onWheel={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      >
        <div className="p-2 border-b border-border">
          <Input
            placeholder="Search icons..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 text-sm"
            autoFocus
          />
        </div>
        <div className="h-72 overflow-y-auto overscroll-contain">
          <div className="grid grid-cols-6 gap-1 p-2">
            {filtered.slice(0, MAX_VISIBLE).map((name) => {
              const isCurrent = name === currentKebab
              return (
                <button
                  key={name}
                  className={cn(
                    'flex items-center justify-center h-9 w-9 rounded-md transition-colors',
                    isCurrent ? 'bg-primary/20 ring-1 ring-primary/50' : 'hover:bg-accent',
                  )}
                  title={formatIconName(name)}
                  onClick={() => {
                    const selected = toPascalCase(name)
                    setOpen(false)
                    setSearch('')
                    // Defer the customization save so the popover closes first
                    // before the re-render storm from iconCustomizationVersion bump
                    requestAnimationFrame(() => onSelect(selected))
                  }}
                >
                  <DynamicIcon name={name} className="h-4 w-4 text-foreground" />
                </button>
              )
            })}
          </div>
          {filtered.length > MAX_VISIBLE && (
            <p className="py-2 text-center text-[10px] text-muted-foreground">
              Showing {MAX_VISIBLE} of {filtered.length} — refine your search
            </p>
          )}
          {filtered.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">No icons found.</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** Convert kebab-case to spaced words: "circle-check" -> "Circle Check" */
function formatIconName(name: string): string {
  return name
    .split('-')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ')
}
