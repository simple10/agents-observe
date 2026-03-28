import { useState, useMemo } from 'react'
import { icons as allLucideIcons } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { ICON_CATALOG, ICON_CATEGORIES } from '@/config/icon-catalog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface IconPickerProps {
  currentIconName: string
  iconColorClass: string
  onSelect: (iconName: string) => void
}

export function IconPicker({ currentIconName, iconColorClass, onSelect }: IconPickerProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const CurrentIcon = (allLucideIcons as Record<string, LucideIcon>)[currentIconName]

  const filteredByCategory = useMemo(() => {
    const lower = search.toLowerCase()
    if (!lower) return null // show categories when no search

    return ICON_CATALOG.filter((entry) =>
      entry.name.toLowerCase().includes(lower) ||
      entry.category.toLowerCase().includes(lower)
    )
  }, [search])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon-sm"
          className="shrink-0"
          aria-label="Change icon"
        >
          {CurrentIcon ? (
            <CurrentIcon className={cn('h-4 w-4', iconColorClass)} />
          ) : (
            <span className="text-xs text-muted-foreground">?</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search icons..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList className="max-h-64">
            <CommandEmpty>No icons found.</CommandEmpty>
            {filteredByCategory ? (
              <CommandGroup>
                {filteredByCategory.map((entry) => {
                  const Icon = (allLucideIcons as Record<string, LucideIcon>)[entry.name]
                  if (!Icon) return null
                  return (
                    <CommandItem
                      key={entry.name}
                      value={entry.name}
                      onSelect={() => {
                        onSelect(entry.name)
                        setOpen(false)
                        setSearch('')
                      }}
                    >
                      <Icon className="h-4 w-4" />
                      <span className="text-sm">{formatIconName(entry.name)}</span>
                      {entry.name === currentIconName && (
                        <span className="ml-auto text-xs text-muted-foreground">current</span>
                      )}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            ) : (
              ICON_CATEGORIES.map((category) => (
                <CommandGroup key={category} heading={category}>
                  {ICON_CATALOG.filter((e) => e.category === category).map((entry) => {
                    const Icon = (allLucideIcons as Record<string, LucideIcon>)[entry.name]
                    if (!Icon) return null
                    return (
                      <CommandItem
                        key={entry.name}
                        value={entry.name}
                        onSelect={() => {
                          onSelect(entry.name)
                          setOpen(false)
                          setSearch('')
                        }}
                      >
                        <Icon className="h-4 w-4" />
                        <span className="text-sm">{formatIconName(entry.name)}</span>
                        {entry.name === currentIconName && (
                          <span className="ml-auto text-xs text-muted-foreground">current</span>
                        )}
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              ))
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/** Convert PascalCase to spaced words: "CircleCheck" -> "Circle Check" */
function formatIconName(name: string): string {
  return name.replace(/([A-Z])/g, ' $1').trim()
}
