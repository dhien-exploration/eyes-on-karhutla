import type { ExpressionSpecification } from 'maplibre-gl'
import type { ColorScheme } from './basemap'

// Province shading by ONE series at a time (the user switches between them).
// MODIS and VIIRS are never combined: each series has its own classes and its
// own single-hue ramp in the series colour (AGENTS.md section 7).
export const COLOR_BY = ['modis', 'viirs_snpp'] as const
export type ColorBy = (typeof COLOR_BY)[number]

export interface ChoroplethScale {
  colorBy: ColorBy
  /** Lower bounds of classes 2..n; class 1 starts at 1. Zero is its own class. */
  breaks: number[]
  /** One colour per class (breaks.length + 1), light → dark in light mode. */
  colors: string[]
  zeroColor: string
  max: number
}

const CLASSES = 5

/** Rounds to two significant digits (e.g. 1234 → 1200) so legend labels read cleanly. */
export function niceRound(value: number): number {
  if (value < 10) return Math.max(1, Math.round(value))
  const magnitude = 10 ** (Math.floor(Math.log10(value)) - 1)
  return Math.round(value / magnitude) * magnitude
}

/**
 * Class breaks from the quantiles of the non-zero values, rounded to nice
 * numbers. Display classification only: it groups exported totals, it does
 * not derive a new metric.
 */
export function classBreaks(values: number[], classes = CLASSES): number[] {
  const sorted = values.filter((v) => v > 0).sort((a, b) => a - b)
  if (sorted.length === 0) return []
  const breaks: number[] = []
  for (let i = 1; i < classes; i++) {
    const q = sorted[Math.floor((i / classes) * sorted.length)]
    const b = niceRound(q)
    if (b > 1 && b <= sorted[sorted.length - 1] && b > (breaks[breaks.length - 1] ?? 1)) breaks.push(b)
  }
  return breaks
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
}

function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a)
  const [br, bg, bb] = hexToRgb(b)
  const c = (x: number, y: number) => Math.round(x + (y - x) * t).toString(16).padStart(2, '0')
  return `#${c(ar, br)}${c(ag, bg)}${c(ab, bb)}`
}

/**
 * Single-hue sequential ramp in the series colour. Light mode runs from a pale
 * tint to a dark shade; dark mode runs from near the background to a bright tint,
 * so "more" is always the stronger colour against the page.
 */
export function rampColors(hue: string, scheme: ColorScheme, classes: number): string[] {
  const ramp =
    scheme === 'light'
      ? [mix(hue, '#ffffff', 0.82), mix(hue, '#ffffff', 0.62), mix(hue, '#ffffff', 0.38), hue, mix(hue, '#000000', 0.35)]
      : [mix(hue, '#1a1a18', 0.72), mix(hue, '#1a1a18', 0.5), mix(hue, '#1a1a18', 0.25), hue, mix(hue, '#ffffff', 0.3)]
  // Fewer classes keep the strong end of the ramp.
  return ramp.slice(CLASSES - classes)
}

export const ZERO_COLOR: Record<ColorScheme, string> = { light: '#dcdad3', dark: '#3a3935' }

export function buildScale(
  colorBy: ColorBy,
  values: number[],
  hue: string,
  scheme: ColorScheme,
): ChoroplethScale {
  const breaks = classBreaks(values)
  return {
    colorBy,
    breaks,
    colors: rampColors(hue, scheme, breaks.length + 1),
    zeroColor: ZERO_COLOR[scheme],
    max: Math.max(0, ...values),
  }
}

/** MapLibre fill-color for a scale, reading the flattened `total_<series>` property. */
export function fillColorExpression(scale: ChoroplethScale): ExpressionSpecification {
  const value: ExpressionSpecification = ['get', `total_${scale.colorBy}`]
  const step: ExpressionSpecification =
    scale.breaks.length === 0
      ? ['literal', scale.colors[0]]
      : (['step', value, scale.colors[0], ...scale.breaks.flatMap((b, i) => [b, scale.colors[i + 1]])] as ExpressionSpecification)
  return ['case', ['<=', value, 0], scale.zeroColor, step]
}

/** Legend rows: zero, then one row per class as an inclusive range. */
export function legendRows(scale: ChoroplethScale): { color: string; from: number; to: number }[] {
  const starts = [1, ...scale.breaks]
  const rows = [{ color: scale.zeroColor, from: 0, to: 0 }]
  starts.forEach((from, i) => {
    const next = starts[i + 1]
    rows.push({ color: scale.colors[i], from, to: next === undefined ? scale.max : next - 1 })
  })
  return rows
}
