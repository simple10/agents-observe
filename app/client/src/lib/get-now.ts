import { useUIStore } from '@/stores/ui-store'

/**
 * Returns the current "now" timestamp for timeline calculations.
 * When timeOverride is set (time travel mode), returns that instead of Date.now().
 */
export function getNow(): number {
  return useUIStore.getState().timeOverride ?? Date.now()
}
