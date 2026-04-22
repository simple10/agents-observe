import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { useUIStore } from '@/stores/ui-store'
import { ProjectList } from './project-list'
import { LabelList } from './label-list'

interface ProjectLabelTabsProps {
  collapsed: boolean
}

/**
 * Switcher between the Projects and Labels views in the sidebar. In
 * collapsed (narrow) mode, tabs are hidden and the current view
 * renders as icon-only — tabs don't fit the narrow width cleanly.
 */
export function ProjectLabelTabs({ collapsed }: ProjectLabelTabsProps) {
  const sidebarTab = useUIStore((s) => s.sidebarTab)
  const setSidebarTab = useUIStore((s) => s.setSidebarTab)

  if (collapsed) {
    // Narrow sidebar: render whichever view is active, without the tab
    // strip. Users rely on the icons themselves (Folder vs Tag) to
    // recognize which view they're in.
    return sidebarTab === 'labels' ? <LabelList collapsed /> : <ProjectList collapsed />
  }

  return (
    <Tabs
      value={sidebarTab}
      onValueChange={(v) => setSidebarTab(v as 'projects' | 'labels')}
      className="flex flex-col"
    >
      <TabsList className="w-full mt-2">
        <TabsTrigger value="projects" className="flex-1">
          Projects
        </TabsTrigger>
        <TabsTrigger value="labels" className="flex-1">
          Labels
        </TabsTrigger>
      </TabsList>
      <TabsContent value="projects" className="mt-1">
        <ProjectList collapsed={false} />
      </TabsContent>
      <TabsContent value="labels" className="mt-1">
        <LabelList collapsed={false} />
      </TabsContent>
    </Tabs>
  )
}
