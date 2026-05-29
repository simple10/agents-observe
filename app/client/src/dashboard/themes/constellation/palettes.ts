/**
 * Constellation visual palettes. The actual colors live as CSS custom
 * properties in constellation.css (one block per `[data-palette]`); this
 * module owns the palette list + the pure color math that the render loop
 * uses to interpolate a "temperature" color from heat.
 */

export type RGB = [number, number, number]

export interface ConstellationPalette {
  id: string
  name: string
}

export const PALETTES: ConstellationPalette[] = [
  { id: 'native', name: 'Native' },
  { id: 'space', name: 'Deep Space' },
  { id: 'biolum', name: 'Bioluminescent' },
]

export const DEFAULT_PALETTE_ID = 'native'

export function resolvePaletteId(id: string | null | undefined): string {
  return PALETTES.some((p) => p.id === id) ? (id as string) : DEFAULT_PALETTE_ID
}

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n)

/** Parse `#rgb` / `#rrggbb` / `rgb(r,g,b)` into an RGB triple. Falls back to black. */
export function parseColor(input: string): RGB {
  const s = input.trim()
  const rgbMatch = s.match(/rg(?:b|ba)?\(([^)]+)\)/i)
  if (rgbMatch) {
    const parts = rgbMatch[1].split(',').map((p) => parseFloat(p))
    return [parts[0] || 0, parts[1] || 0, parts[2] || 0]
  }
  let hex = s.replace('#', '')
  if (hex.length === 3)
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('')
  const h6 = hex.slice(0, 6)
  if (/^[0-9a-f]{6}$/i.test(h6)) {
    return [
      parseInt(h6.slice(0, 2), 16),
      parseInt(h6.slice(2, 4), 16),
      parseInt(h6.slice(4, 6), 16),
    ]
  }
  return [0, 0, 0]
}

export function lerpRgb(a: RGB, b: RGB, f: number): RGB {
  const t = clamp01(f)
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ]
}

/**
 * Map a temperature `t` in [0,1] to an `rgb(...)` string, blending
 * cool → warm at the low half and warm → hot at the high half.
 */
export function tempColor(t: number, cool: RGB, warm: RGB, hot: RGB): string {
  const v = clamp01(t)
  const c = v < 0.5 ? lerpRgb(cool, warm, v / 0.5) : lerpRgb(warm, hot, (v - 0.5) / 0.5)
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`
}
