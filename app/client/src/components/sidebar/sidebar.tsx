import { useCallback, useRef, useState } from 'react'
import { PanelLeftClose, PanelLeftOpen, Moon, Sun, Wifi, WifiOff, Settings } from 'lucide-react'
import { cn, isNewerVersion } from '@/lib/utils'
import { useUIStore } from '@/stores/ui-store'
import { useTheme } from '@/components/theme-provider'
import { ProjectLabelTabs } from './project-label-tabs'
import { PinnedSessions } from './pinned-sessions'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { SettingsModal } from '@/components/settings/settings-modal'
import { ChangelogModal } from '@/components/changelog-modal'

interface SidebarProps {
  connected: boolean
}

export function Sidebar({ connected }: SidebarProps) {
  const { sidebarCollapsed, sidebarWidth, setSidebarCollapsed, setSidebarWidth } = useUIStore()
  const latestVersion = useUIStore((s) => s.latestVersion)
  const serverVersion = useUIStore((s) => s.serverVersion)
  const outdated = latestVersion ? isNewerVersion(__APP_VERSION__, latestVersion) : false
  const versionMismatch = serverVersion ? serverVersion !== __APP_VERSION__ : false
  const { theme, toggleTheme } = useTheme()
  const resizing = useRef(false)
  const openSettings = useUIStore((s) => s.openSettings)
  const [changelogOpen, setChangelogOpen] = useState(false)

  const sidebarRef = useRef<HTMLDivElement>(null)

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (sidebarCollapsed) return
      e.preventDefault()
      resizing.current = true
      // Disable CSS transition during drag for smooth resizing
      if (sidebarRef.current) sidebarRef.current.style.transition = 'none'

      const onMouseMove = (e: MouseEvent) => {
        if (!resizing.current) return
        const newWidth = Math.max(200, Math.min(400, e.clientX))
        if (sidebarRef.current) sidebarRef.current.style.width = `${newWidth}px`
      }

      const onMouseUp = (e: MouseEvent) => {
        resizing.current = false
        if (sidebarRef.current) sidebarRef.current.style.transition = ''
        const finalWidth = Math.max(200, Math.min(400, e.clientX))
        setSidebarWidth(finalWidth)
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
      }

      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    },
    [sidebarCollapsed, setSidebarWidth],
  )

  return (
    <div
      ref={sidebarRef}
      className={cn(
        '@container relative flex flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200',
        sidebarCollapsed ? 'w-12' : '',
      )}
      style={sidebarCollapsed ? undefined : { width: sidebarWidth }}
    >
      {/* Header */}
      <div
        className={cn(
          'flex items-center h-12',
          sidebarCollapsed ? 'flex-col justify-center gap-1 p-1' : 'gap-2 p-3',
        )}
      >
        {!sidebarCollapsed && (
          <button
            className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity"
            onClick={() => {
              useUIStore.getState().setSelectedProject(null)
            }}
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground text-xs font-bold">
              O
            </div>
            <span className="text-sm font-semibold truncate">Observe</span>
          </button>
        )}
        {!sidebarCollapsed && <div className="flex-1" />}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        >
          {sidebarCollapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </Button>
      </div>

      <Separator />

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-2">
        <PinnedSessions collapsed={sidebarCollapsed} />
        <ProjectLabelTabs collapsed={sidebarCollapsed} />
      </div>

      <Separator />

      {/* Footer */}
      <div
        className={cn('flex items-center gap-1 p-2', sidebarCollapsed ? 'flex-col h-auto' : 'h-10')}
      >
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={toggleTheme}>
          {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openSettings()}>
          <Settings className="h-3.5 w-3.5" />
        </Button>
        {!sidebarCollapsed && (
          <button
            className="flex items-center gap-1.5 ml-auto text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
            onClick={() => setChangelogOpen(true)}
          >
            {connected ? (
              <>
                <Wifi className="h-3 w-3 text-green-500" />
                <span>Connected</span>
              </>
            ) : (
              <>
                <WifiOff className="h-3 w-3 text-destructive" />
                <span>Disconnected</span>
              </>
            )}
            <span
              className={cn(
                'transition-colors',
                versionMismatch
                  ? 'px-1.5 py-0.5 rounded-full border border-red-400 text-red-500 dark:border-red-500 dark:text-red-400'
                  : outdated
                    ? 'px-1.5 py-0.5 rounded-full border border-orange-400 text-orange-500 dark:border-orange-500 dark:text-orange-400'
                    : 'text-muted-foreground/50',
              )}
            >
              v{__APP_VERSION__}
            </span>
          </button>
        )}
      </div>

      <SettingsModal />
      <ChangelogModal open={changelogOpen} onOpenChange={setChangelogOpen} />

      {/* Resize handle */}
      {!sidebarCollapsed && (
        <div
          className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/20 active:bg-primary/30"
          onMouseDown={handleMouseDown}
        />
      )}
    </div>
  )
}
