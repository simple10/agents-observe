import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogClose, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { ProjectsTab } from './projects-tab'
import { SessionsTab } from './sessions-tab'
import { LabelsModalBody } from '@/components/labels/labels-modal'
import { IconSettings } from './icon-settings'
import { GeneralSettings } from './general-settings'
import { useUIStore } from '@/stores/ui-store'
import { Button } from '@/components/ui/button'
import { API_BASE } from '@/config/api'
import { Database, Container, Monitor, X } from 'lucide-react'

interface ServerInfo {
  dbPath: string
  runtime: 'docker' | 'local'
}

export function SettingsModal() {
  const open = useUIStore((s) => s.settingsOpen)
  // Read tab + setter straight from the store so switching tabs inside
  // the modal persists to localStorage and the gear icon reopens there
  // next time.
  const activeTab = useUIStore((s) => s.settingsTab)
  const setSettingsTab = useUIStore((s) => s.setSettingsTab)
  const closeSettings = useUIStore((s) => s.closeSettings)
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null)

  const onOpenChange = (o: boolean) => {
    if (!o) closeSettings()
  }

  useEffect(() => {
    if (open && !serverInfo) {
      fetch(`${API_BASE}/health`)
        .then((r) => r.json())
        .then((data) => {
          if (data.dbPath) setServerInfo({ dbPath: data.dbPath, runtime: data.runtime || 'local' })
        })
        .catch(() => {})
    }
  }, [open, serverInfo])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="w-[720px] max-w-[90vw] max-h-[80vh] flex flex-col p-0"
      >
        <div className="flex items-center px-6 pt-6 pb-0">
          <DialogTitle>Settings</DialogTitle>
          <div className="ml-auto">
            <DialogClose asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" title="Close">
                <X className="h-4 w-4" />
              </Button>
            </DialogClose>
          </div>
        </div>
        <Tabs
          value={activeTab}
          onValueChange={setSettingsTab}
          className="flex-1 flex flex-col min-h-0"
        >
          <div className="px-6 pt-2">
            <TabsList>
              <TabsTrigger value="settings">Display</TabsTrigger>
              <TabsTrigger value="icons">Icons</TabsTrigger>
              <TabsTrigger value="projects">Projects</TabsTrigger>
              <TabsTrigger value="sessions">Sessions</TabsTrigger>
              <TabsTrigger value="labels">Labels</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="settings" className="flex-1 min-h-0 overflow-y-auto px-6 pb-6 pt-4">
            <GeneralSettings />
          </TabsContent>
          <TabsContent
            value="icons"
            className="flex-1 min-h-0 px-6 pb-6 pt-4"
            style={{ maxHeight: 'calc(80vh - 140px)' }}
          >
            <IconSettings />
          </TabsContent>
          <TabsContent value="projects" className="flex-1 min-h-0 overflow-y-auto px-6 pb-6 pt-4">
            <ProjectsTab />
          </TabsContent>
          <TabsContent value="sessions" className="flex-1 min-h-0 overflow-y-auto px-6 pb-6 pt-4">
            <SessionsTab />
          </TabsContent>
          {/* Labels tab deliberately skips the outer px-6/pb-6/pt-4
              padding because LabelsModalBody handles its own scrolling
              + internal padding (port of the old standalone
              LabelsModal). */}
          <TabsContent value="labels" className="flex-1 min-h-0 flex flex-col">
            <LabelsModalBody />
          </TabsContent>
        </Tabs>
        {serverInfo && (
          <div className="px-6 py-3 border-t text-[11px] text-muted-foreground/60 flex items-center gap-1.5">
            {serverInfo.runtime === 'docker' ? (
              <Container className="h-3 w-3 shrink-0" />
            ) : (
              <Monitor className="h-3 w-3 shrink-0" />
            )}
            <span className="shrink-0">{serverInfo.runtime === 'docker' ? 'Docker' : 'Local'}</span>
            <span className="text-muted-foreground/30">|</span>
            <Database className="h-3 w-3 shrink-0" />
            <span className="truncate">{serverInfo.dbPath}</span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
