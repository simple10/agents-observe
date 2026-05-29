import { Check, LayoutGrid } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { dashboardThemes } from './registry'

interface ThemeSwitcherProps {
  activeId: string
  onSelect: (id: string) => void
}

/** Small dropdown in the home header for picking the active dashboard theme. */
export function ThemeSwitcher({ activeId, onSelect }: ThemeSwitcherProps) {
  const active = dashboardThemes.find((t) => t.id === activeId) ?? dashboardThemes[0]
  const ActiveIcon = active.icon ?? LayoutGrid

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground cursor-pointer"
          title="Change dashboard view"
        >
          <ActiveIcon className="h-3 w-3" />
          {active.name}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs">Dashboard view</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {dashboardThemes.map((theme) => {
          const Icon = theme.icon ?? LayoutGrid
          const isActive = theme.id === active.id
          return (
            <DropdownMenuItem
              key={theme.id}
              onSelect={() => onSelect(theme.id)}
              className="flex items-start gap-2"
            >
              <Icon className="h-4 w-4 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium flex items-center gap-1">
                  {theme.name}
                  {isActive && <Check className="h-3 w-3 text-foreground" />}
                </div>
                {theme.description && (
                  <div className="text-[10px] text-muted-foreground leading-snug">
                    {theme.description}
                  </div>
                )}
              </div>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Shared classNames so the sort toggle matches the switcher button. */
export const homeHeaderButton = cn(
  'flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground cursor-pointer',
)
