import { useState } from 'react'
import { COLOR_PRESETS } from '@/hooks/use-icon-customizations'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Check } from 'lucide-react'

interface ColorPickerProps {
  currentColor: string | undefined // color preset key
  onSelect: (colorName: string) => void
  /** Fallback swatch color when no custom color is set */
  defaultSwatch?: string
}

const colorKeys = Object.keys(COLOR_PRESETS)

export function ColorPicker({ currentColor, onSelect, defaultSwatch }: ColorPickerProps) {
  const [open, setOpen] = useState(false)

  const activeSwatch = currentColor
    ? COLOR_PRESETS[currentColor]?.swatch
    : defaultSwatch || '#6b7280'

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon-sm"
          className="shrink-0"
          aria-label="Change color"
        >
          <div
            className="h-3.5 w-3.5 rounded-full border border-border"
            style={{ backgroundColor: activeSwatch }}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" align="start">
        <div className="grid grid-cols-5 gap-1.5">
          {colorKeys.map((key) => {
            const preset = COLOR_PRESETS[key]
            const isSelected = key === currentColor
            return (
              <button
                key={key}
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-md border transition-colors',
                  isSelected
                    ? 'border-foreground'
                    : 'border-transparent hover:border-border',
                )}
                style={{ backgroundColor: preset.swatch }}
                title={preset.label}
                onClick={() => {
                  onSelect(key)
                  setOpen(false)
                }}
              >
                {isSelected && (
                  <Check className="h-3.5 w-3.5 text-white drop-shadow-sm" />
                )}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
