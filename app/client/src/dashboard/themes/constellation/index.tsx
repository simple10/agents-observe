import { Sparkles } from 'lucide-react'
import type { DashboardTheme } from '../../types'
import { ConstellationView } from './constellation-view'

export const constellationTheme: DashboardTheme = {
  id: 'constellation',
  name: 'Constellation',
  description: 'Live force-directed star map — sessions glow by activity, subagents orbit.',
  icon: Sparkles,
  usesSort: false,
  Component: ConstellationView,
}
