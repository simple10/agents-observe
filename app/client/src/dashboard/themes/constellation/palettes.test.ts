import { describe, it, expect } from 'vitest'
import { parseColor, lerpRgb, tempColor, resolvePaletteId, type RGB } from './palettes'

describe('parseColor', () => {
  it('parses #rrggbb', () => {
    expect(parseColor('#ff8800')).toEqual([255, 136, 0])
  })
  it('parses shorthand #rgb', () => {
    expect(parseColor('#f80')).toEqual([255, 136, 0])
  })
  it('parses rgb()/rgba()', () => {
    expect(parseColor('rgb(10, 20, 30)')).toEqual([10, 20, 30])
    expect(parseColor('rgba(10, 20, 30, 0.5)')).toEqual([10, 20, 30])
  })
  it('falls back to black on garbage', () => {
    expect(parseColor('not-a-color')).toEqual([0, 0, 0])
  })
})

describe('lerpRgb', () => {
  const a: RGB = [0, 0, 0]
  const b: RGB = [100, 200, 50]
  it('returns endpoints at f=0 and f=1', () => {
    expect(lerpRgb(a, b, 0)).toEqual([0, 0, 0])
    expect(lerpRgb(a, b, 1)).toEqual([100, 200, 50])
  })
  it('interpolates and rounds at the midpoint', () => {
    expect(lerpRgb(a, b, 0.5)).toEqual([50, 100, 25])
  })
  it('clamps f outside [0,1]', () => {
    expect(lerpRgb(a, b, -1)).toEqual([0, 0, 0])
    expect(lerpRgb(a, b, 2)).toEqual([100, 200, 50])
  })
})

describe('tempColor', () => {
  const cool: RGB = [0, 0, 255]
  const warm: RGB = [255, 255, 0]
  const hot: RGB = [255, 0, 0]
  it('is cool at 0, warm at 0.5, hot at 1', () => {
    expect(tempColor(0, cool, warm, hot)).toBe('rgb(0, 0, 255)')
    expect(tempColor(0.5, cool, warm, hot)).toBe('rgb(255, 255, 0)')
    expect(tempColor(1, cool, warm, hot)).toBe('rgb(255, 0, 0)')
  })
  it('clamps out-of-range temperatures', () => {
    expect(tempColor(-5, cool, warm, hot)).toBe('rgb(0, 0, 255)')
    expect(tempColor(99, cool, warm, hot)).toBe('rgb(255, 0, 0)')
  })
})

describe('resolvePaletteId', () => {
  it('keeps a known id', () => {
    expect(resolvePaletteId('space')).toBe('space')
  })
  it('falls back to native for unknown/empty', () => {
    expect(resolvePaletteId('nope')).toBe('native')
    expect(resolvePaletteId(null)).toBe('native')
  })
})
