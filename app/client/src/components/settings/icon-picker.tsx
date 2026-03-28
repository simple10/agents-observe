import { useState, useMemo, useEffect } from 'react'
import { icons as allLucideIcons } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
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

// Pre-compute the full icon list once
const ALL_ICON_NAMES = Object.keys(allLucideIcons as Record<string, LucideIcon>).sort()

export function IconPicker({ currentIconName, iconColorClass, iconStyle, onSelect }: IconPickerProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const CurrentIcon = (allLucideIcons as Record<string, LucideIcon>)[currentIconName]

  // When the picker is open, prevent scrolling on the modal behind it
  useEffect(() => {
    if (!open) return
    const handler = (e: WheelEvent) => {
      // Allow scrolling inside the popover, block everywhere else
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
    return ALL_ICON_NAMES.filter((name) => name.toLowerCase().includes(lower))
  }, [search])

  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) setSearch('') }}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon-sm"
          className="shrink-0"
          aria-label="Change icon"
        >
          {CurrentIcon ? (
            <CurrentIcon className={cn('h-4 w-4', iconColorClass)} style={iconStyle} />
          ) : (
            <span className="text-xs text-muted-foreground">?</span>
          )}
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
            {filtered.map((name) => {
              const Icon = (allLucideIcons as Record<string, LucideIcon>)[name]
              if (!Icon) return null
              const isCurrent = name === currentIconName
              return (
                <button
                  key={name}
                  className={cn(
                    'flex items-center justify-center h-9 w-9 rounded-md transition-colors',
                    isCurrent
                      ? 'bg-primary/20 ring-1 ring-primary/50'
                      : 'hover:bg-accent',
                  )}
                  title={formatIconName(name)}
                  onClick={() => {
                    onSelect(name)
                    setOpen(false)
                    setSearch('')
                  }}
                >
                  <Icon className="h-4 w-4 text-foreground" />
                </button>
              )
            })}
          </div>
          {filtered.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">No icons found.</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** Convert PascalCase to spaced words: "CircleCheck" -> "Circle Check" */
function formatIconName(name: string): string {
  return name.replace(/([A-Z])/g, ' $1').trim()
}
