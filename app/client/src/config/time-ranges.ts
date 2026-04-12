export const TIME_RANGES = {
  '1m': { ms: 60_000, ticks: 6 },
  '5m': { ms: 300_000, ticks: 5 },
  '10m': { ms: 600_000, ticks: 5 },
  '60m': { ms: 3_600_000, ticks: 6 },
  '3h': { ms: 10_800_000, ticks: 6 },
  '24h': { ms: 86_400_000, ticks: 6 },
} as const

export type TimeRange = keyof typeof TIME_RANGES

export const TIME_RANGE_KEYS: TimeRange[] = Object.keys(TIME_RANGES) as TimeRange[]

export function getRangeMs(range: TimeRange): number {
  return TIME_RANGES[range].ms
}

export function getRangeTicks(range: TimeRange): number {
  return TIME_RANGES[range].ticks
}
