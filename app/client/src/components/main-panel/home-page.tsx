import { DashboardHost } from '@/dashboard/dashboard-host'

/**
 * The home page is a thin wrapper around the pluggable dashboard host, which
 * fetches recent sessions and renders the active dashboard theme (list,
 * constellation, …). See app/client/src/dashboard/.
 */
export function HomePage() {
  return <DashboardHost />
}
