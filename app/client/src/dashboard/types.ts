import type { ComponentType } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { RecentSession } from '@/types'

/**
 * Props every dashboard theme receives. The host owns data fetching, sort,
 * and navigation; a theme is just a way to render the same session set.
 */
export interface DashboardThemeProps {
  /** Recent sessions across all projects, already sorted by the host. */
  sessions: RecentSession[]
  isLoading: boolean
  /** Navigate to a session's full detail view. */
  onOpenSession: (session: RecentSession) => void
}

/**
 * A pluggable whole-home-page visualization. Register new ones in
 * `registry.tsx`; the active one is chosen by `dashboardThemeId` in the
 * UI store and resolved back to the default if unknown.
 */
export interface DashboardTheme {
  /** Stable id persisted to localStorage. */
  id: string
  name: string
  description?: string
  icon?: LucideIcon
  /**
   * Whether this theme uses the activity/created sort. The host hides the
   * sort toggle when false (the constellation positions by physics, not order).
   */
  usesSort?: boolean
  Component: ComponentType<DashboardThemeProps>
}
