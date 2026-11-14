import type { Manifest, MonthlySeries } from '../data'

// Monthly chart data (lode/chart/monthly.md). Display only: every value is an
// exported monthly total; missing months stay null (gaps), never 0.

export const CHART_SERIES = ['modis', 'viirs_snpp'] as const
export type ChartSeries = (typeof CHART_SERIES)[number]

/** "2019-08" → seconds since epoch at 1 Aug 2019 00:00 UTC (uPlot's x unit). */
export function monthStart(month: string): number {
  const [y, m] = month.split('-').map(Number)
  return Date.UTC(y, m - 1, 1) / 1000
}

/** Seconds at 1 Jan of `year` and of the next year, for shading a picked year. */
export function yearSpan(year: string): [number, number] {
  return [Date.UTC(Number(year), 0, 1) / 1000, Date.UTC(Number(year) + 1, 0, 1) / 1000]
}

/** uPlot data: x (month starts), then one array per chart series (null = gap). */
export function chartData(monthly: MonthlySeries): [number[], ...(number | null)[][]] {
  return [monthly.months.map(monthStart), ...CHART_SERIES.map((s) => monthly[s])]
}

/** Indices of partial months (drawn as hollow points). */
export function partialIndices(monthly: MonthlySeries): number[] {
  return monthly.status.flatMap((s, i) => (s === 'partial' ? [i] : []))
}

export interface PlatformMarker {
  /** Seconds since epoch. */
  at: number
  date: string
  platform: string
  kind: 'start' | 'end'
}

/**
 * Where a satellite of a charted series starts or stops contributing, inside
 * the chart's range (exported first/last detection seen in the data). Edges at
 * the very start or end of the range carry no information and are skipped.
 */
export function platformMarkers(manifest: Manifest, monthly: MonthlySeries): PlatformMarker[] {
  if (monthly.months.length === 0) return []
  const first = monthStart(monthly.months[0])
  const lastEnd = monthStart(monthly.months.at(-1)!) + 31 * 86_400
  const markers: PlatformMarker[] = []
  for (const series of CHART_SERIES) {
    for (const [platform, period] of Object.entries(manifest.series[series].platform_periods)) {
      for (const [kind, date] of [['start', period.start], ['end', period.end]] as const) {
        if (!date) continue
        const at = Date.parse(`${date}T00:00:00Z`) / 1000
        // Months are monthly buckets: a start within the first month is the edge of the data.
        if (at <= first + 31 * 86_400 || at >= lastEnd - 31 * 86_400) continue
        markers.push({ at, date, platform, kind })
      }
    }
  }
  return markers
}

/** Width given to each month, in CSS px. Long ranges scroll sideways rather than squeeze. */
export const MONTH_WIDTH = 12
/** The narrowest gap between two x labels, in CSS px (labels are rotated 30°). */
const MIN_TICK_GAP = 30

/** The chart's plot width: a fixed width per month, or the available width if wider. */
export function plotWidth(monthly: MonthlySeries, available: number): number {
  return Math.max(available, monthly.months.length * MONTH_WIDTH)
}

/**
 * X-axis ticks: every January, plus every 6, 3 or 1 month(s) when there is room
 * (`monthWidth` = px per month), so the year is always labelled whatever the
 * range (uPlot's own time ticks can skip January entirely).
 */
export function monthTicks(monthly: MonthlySeries, monthWidth: number): number[] {
  const step = [1, 3, 6].find((n) => n * monthWidth >= MIN_TICK_GAP) ?? 12
  return monthly.months.filter((m) => (Number(m.slice(5, 7)) - 1) % step === 0).map(monthStart)
}

/** The WIB year (as "YYYY") of a month index, for "click a month → pick its year". */
export function yearOfIndex(monthly: MonthlySeries, index: number): string | null {
  return monthly.months[index]?.slice(0, 4) ?? null
}
