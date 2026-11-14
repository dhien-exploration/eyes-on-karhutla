import {
  buildScale,
  classBreaks,
  fillColorExpression,
  legendRows,
  niceRound,
  rampColors,
} from '../../src/map/choropleth'

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

describe('niceRound', () => {
  it('keeps two significant digits', () => {
    expect(niceRound(1234)).toBe(1200)
    expect(niceRound(9910)).toBe(9900)
    expect(niceRound(129)).toBe(130)
    expect(niceRound(7.4)).toBe(7)
    expect(niceRound(0.3)).toBe(1)
  })
})

describe('classBreaks', () => {
  it('uses quantiles of the non-zero values, ascending and above 1', () => {
    const values = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
    const breaks = classBreaks(values)
    expect(breaks).toEqual([30, 50, 70, 90])
  })

  it('collapses duplicate breaks for flat data', () => {
    expect(classBreaks([5, 5, 5, 5, 5, 5])).toEqual([5])
  })

  it('returns no breaks when everything is zero', () => {
    expect(classBreaks([0, 0, 0])).toEqual([])
  })
})

describe('rampColors', () => {
  it('runs light to dark in light mode and dark to light in dark mode', () => {
    const light = rampColors('#2a78d6', 'light', 5).map(luminance)
    const dark = rampColors('#2a78d6', 'dark', 5).map(luminance)
    for (let i = 1; i < 5; i++) {
      expect(light[i]).toBeLessThan(light[i - 1])
      expect(dark[i]).toBeGreaterThan(dark[i - 1])
    }
  })

  it('keeps the strong end when there are fewer classes', () => {
    expect(rampColors('#eb6834', 'light', 2)).toEqual(rampColors('#eb6834', 'light', 5).slice(3))
  })
})

describe('scale, legend and expression', () => {
  const scale = buildScale('modis', [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100], '#2a78d6', 'light')

  it('has one colour per class and a separate zero colour', () => {
    expect(scale.colors).toHaveLength(scale.breaks.length + 1)
    expect(scale.colors).not.toContain(scale.zeroColor)
  })

  it('lists zero, then contiguous inclusive ranges up to the maximum', () => {
    expect(legendRows(scale).map(({ from, to }) => [from, to])).toEqual([
      [0, 0],
      [1, 29],
      [30, 49],
      [50, 69],
      [70, 89],
      [90, 100],
    ])
  })

  it('shades by the chosen series only', () => {
    const expr = JSON.stringify(fillColorExpression(scale))
    expect(expr).toContain('"total_modis"')
    expect(expr).not.toContain('viirs')
    expect(JSON.stringify(fillColorExpression({ ...scale, colorBy: 'viirs_snpp' }))).not.toContain('modis')
  })
})
