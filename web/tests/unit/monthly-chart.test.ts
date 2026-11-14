import { MONTH_WIDTH, chartData, monthStart, monthTicks, plotWidth, partialIndices, platformMarkers, yearOfIndex, yearSpan } from '../../src/chart/monthly'
import * as fx from './data/fixtures'

const series = (months: string[]) => ({
  ...fx.monthly(),
  months,
  status: months.map(() => 'complete' as const),
  modis: months.map(() => 1),
  viirs_snpp: months.map(() => 2),
  viirs_all: months.map(() => 3),
})

describe('monthly chart helpers', () => {
  it('turns months into UTC month starts in seconds', () => {
    expect(monthStart('2019-08')).toBe(Date.UTC(2019, 7, 1) / 1000)
    expect(yearSpan('2019')).toEqual([Date.UTC(2019, 0, 1) / 1000, Date.UTC(2020, 0, 1) / 1000])
  })

  it('keeps missing months as null (a gap), never 0, and only charts MODIS and VIIRS S-NPP', () => {
    const [x, modis, viirs, ...rest] = chartData(fx.monthly() as never)
    expect(x).toHaveLength(3)
    expect(modis).toEqual([3, 10, null])
    expect(viirs).toEqual([8, 30, null])
    expect(rest).toHaveLength(0)
  })

  it('marks partial months', () => {
    expect(partialIndices(fx.monthly() as never)).toEqual([0])
  })

  it('maps a month index to its year', () => {
    expect(yearOfIndex(fx.monthly() as never, 1)).toBe('2019')
    expect(yearOfIndex(fx.monthly() as never, 99)).toBeNull()
  })

  it('ticks every January, plus quarters, half-years or every month as room allows', () => {
    const months = series(Array.from({ length: 24 }, (_, i) => `${2019 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`))
    expect(monthTicks(months as never, 12)).toEqual(
      ['2019-01', '2019-04', '2019-07', '2019-10', '2020-01', '2020-04', '2020-07', '2020-10'].map(monthStart),
    )
    expect(monthTicks(months as never, 6)).toEqual(['2019-01', '2019-07', '2020-01', '2020-07'].map(monthStart))
    expect(monthTicks(months as never, 2)).toEqual(['2019-01', '2020-01'].map(monthStart))
    expect(monthTicks(months as never, 40)).toHaveLength(24)
  })

  it('gives each month a fixed width, or the available width if wider', () => {
    const long = series(Array.from({ length: 175 }, () => '2012-01'))
    expect(plotWidth(long as never, 340)).toBe(175 * MONTH_WIDTH)
    expect(plotWidth(series(['2019-01', '2019-02']) as never, 340)).toBe(340)
  })

  it('marks a satellite starting inside the range, but not at its edges', () => {
    const m = fx.manifest()
    m.series.modis.platform_periods = { terra: { start: '2012-01-01', end: null } } as never
    m.series.viirs_snpp.platform_periods = { snpp: { start: '2013-06-15', end: '2015-02-01' } } as never
    const monthly = series(Array.from({ length: 48 }, (_, i) => `${2012 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`))
    expect(platformMarkers(m as never, monthly as never).map((k) => `${k.platform} ${k.kind} ${k.date}`)).toEqual([
      'snpp start 2013-06-15',
      'snpp end 2015-02-01',
    ])
  })
})
