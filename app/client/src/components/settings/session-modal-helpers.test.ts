import { describe, test, expect } from 'vitest'
import { formatDuration } from './session-modal'

describe('formatDuration — used by the All Tools min/median/max columns + longest tool call', () => {
  test.each([
    [500, '500ms'],
    [1_500, '1.5s'],
    [59_500, '59.5s'],
    [60_000, '1m'], // trailing-zero suppression
    [90_000, '1m 30s'],
    [3_600_000, '1h'], // trailing-zero suppression
    [3_660_000, '1h 1m'],
    [82_800_000, '23h'], // 23h flat
  ])('formatDuration(%i) → %s', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected)
  })

  test('days branch with hour rounding', () => {
    // Exactly 24h
    expect(formatDuration(86_400_000)).toBe('1d')
    // 35h: 1d 11h
    expect(formatDuration(126_000_000)).toBe('1d 11h')
    // 34h 51m → rounds up to 35h → "1d 11h"
    expect(formatDuration(125_460_000)).toBe('1d 11h')
    // 34h 29m → rounds down to 34h → "1d 10h"
    expect(formatDuration(124_140_000)).toBe('1d 10h')
    // 1d 23h 50m: rounds to 48h → carries into 2d
    expect(formatDuration(172_200_000)).toBe('2d')
  })
})
