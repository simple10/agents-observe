import { useState } from 'react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { ProjectsTab } from './projects-tab'
import { IconSettings } from './icon-settings'

interface SettingsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SettingsModal({ open, onOpenChange }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState('projects')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[640px] max-w-[90vw] max-h-[80vh] flex flex-col p-0">
        <div className="px-6 pt-6 pb-0">
          <DialogTitle>Settings</DialogTitle>
        </div>
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
          <div className="px-6 pt-2">
            <TabsList>
              <TabsTrigger value="projects">Projects</TabsTrigger>
              <TabsTrigger value="icons">Icons</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="projects" className="flex-1 min-h-0 overflow-y-auto px-6 pb-6 pt-4">
            <ProjectsTab />
          </TabsContent>
          <TabsContent value="icons" className="flex-1 min-h-0 overflow-hidden px-6 pb-6 pt-4">
            <IconSettings />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
