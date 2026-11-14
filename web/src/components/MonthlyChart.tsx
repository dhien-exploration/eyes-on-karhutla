import 'uplot/dist/uPlot.min.css'
import { useEffect, useRef, useState } from 'react'
import uPlot from 'uplot'
import {
  CHART_SERIES,
  chartData,
  monthTicks,
  partialIndices,
  platformMarkers,
  plotWidth,
  yearOfIndex,
  yearSpan,
} from '../chart/monthly'
import type { Manifest, MonthlySeries } from '../data'
import { useI18n } from '../i18n/context'
import { useColorScheme } from '../map/basemap'
import type { Year } from '../map/years'

interface Props {
  monthly: MonthlySeries
  manifest: Manifest
  /** Shaded on the chart (null = all years: no shading). */
  year: Year
  onPickYear: (year: string) => void
  height?: number
}

const LOCALES = { id: 'id-ID', en: 'en-GB' } as const
const HUE: Record<(typeof CHART_SERIES)[number], string> = { modis: '--c-modis', viirs_snpp: '--c-viirs' }
/** The y-label gutter, in CSS px: wide enough for "100 rb" / "1,2 jt". */
const Y_GUTTER = 52
const PAD_RIGHT = 8

/**
 * MODIS and VIIRS S-NPP active cell-days per month on ONE shared y-axis (never
 * stacked, summed or dual-axis). Missing months are gaps, partial months hollow
 * points. Clicking a month picks its year. The canvas is decorative for
 * assistive tech: the section around it provides the caption and a table.
 *
 * Each month gets a fixed width, so long ranges scroll sideways. The y labels
 * (an HTML column over uPlot's transparent y-axis) and the legend stay put.
 */
export function MonthlyChart({ monthly, manifest, year, onPickYear, height = 200 }: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  const container = useRef<HTMLDivElement>(null)
  const yLabels = useRef<HTMLDivElement>(null)
  const legend = useRef<HTMLDivElement>(null)
  const plot = useRef<uPlot | null>(null)
  const [scrollable, setScrollable] = useState(false)
  const { t, lang, formatNumber } = useI18n()
  const scheme = useColorScheme()

  // Read by long-lived uPlot hooks and listeners; updated before the redraw below.
  const latest = useRef({ year, onPickYear })
  useEffect(() => {
    latest.current = { year, onPickYear }
  }, [year, onPickYear])

  useEffect(() => {
    const el = container.current!
    const box = scroller.current!
    const yCol = yLabels.current!
    const size = () => {
      const width = Y_GUTTER + plotWidth(monthly, box.clientWidth - Y_GUTTER - PAD_RIGHT) + PAD_RIGHT
      return { width, height, scrollable: width > box.clientWidth }
    }
    const css = getComputedStyle(document.documentElement)
    const color = (name: string) => css.getPropertyValue(name).trim()
    const short = new Intl.DateTimeFormat(LOCALES[lang], { month: 'short', timeZone: 'UTC' })
    // Compact axis numbers ("100 rb" / "100K") fit the narrow drawer.
    const compact = new Intl.NumberFormat(LOCALES[lang], { notation: 'compact', maximumFractionDigits: 1 })
    const initial = size()
    const ticks = monthTicks(monthly, (initial.width - Y_GUTTER - PAD_RIGHT) / Math.max(1, monthly.months.length))
    const long = new Intl.DateTimeFormat(LOCALES[lang], { month: 'long', year: 'numeric', timeZone: 'UTC' })
    const partial = partialIndices(monthly)
    const markers = platformMarkers(manifest, monthly)
    const muted = color('--c-muted')
    const grid = color('--c-border')
    const font = '11px system-ui, -apple-system, sans-serif'
    // Drawn by uPlot in transparent ink; shown in the fixed HTML column instead.
    let ySplits: { value: number; label: string }[] = []

    const opts: uPlot.Options = {
      width: initial.width,
      height,
      padding: [10, PAD_RIGHT, 0, 0],
      cursor: { drag: { x: false, y: false }, points: { size: 7 } },
      legend: { show: true, live: true, mount: (_u, table) => legend.current!.append(table) },
      scales: { x: { time: true }, y: { range: (_u, _min, max) => [0, max > 0 ? max * 1.08 : 1] } },
      axes: [
        {
          stroke: muted,
          font,
          grid: { stroke: grid, width: 1 },
          ticks: { stroke: grid, width: 1 },
          // Tilted so year and month labels never collide.
          rotate: 30,
          size: 44,
          // Every January (labelled with its year), plus quarters etc. as room allows.
          splits: () => ticks,
          values: (_u, splits) =>
            splits.map((ts) => {
              const d = new Date(ts * 1000)
              return d.getUTCMonth() === 0 ? String(d.getUTCFullYear()) : short.format(d)
            }),
        },
        {
          stroke: 'transparent',
          font,
          size: Y_GUTTER,
          grid: { stroke: grid, width: 1 },
          ticks: { show: false },
          values: (_u, splits) => {
            ySplits = splits.map((v) => ({ value: v, label: compact.format(v) }))
            return ySplits.map((s) => s.label)
          },
        },
      ],
      series: [
        {
          label: t('chart.month'),
          value: (_u, ts, _s, idx) => {
            if (ts == null || idx == null) return ''
            const status = monthly.status[idx]
            const note = status === 'complete' ? '' : ` (${t(status === 'partial' ? 'chart.partial' : 'chart.missing')})`
            return long.format(new Date(ts * 1000)) + note
          },
        },
        ...CHART_SERIES.map((s) => ({
          label: manifest.series[s].label,
          stroke: color(HUE[s]),
          width: 2,
          spanGaps: false,
          value: (_u: uPlot, v: number | null) => (v == null ? '—' : formatNumber(v)),
          points: { show: true, space: 0, size: 7, width: 2, fill: color('--c-surface'), filter: () => partial },
        })),
      ],
      hooks: {
        // The picked year as a band under the lines.
        drawClear: [
          (u) => {
            const picked = latest.current.year
            if (picked === null) return
            const [from, to] = yearSpan(picked)
            const { left, top, width, height: h } = u.bbox
            const x0 = Math.max(left, u.valToPos(from, 'x', true))
            const x1 = Math.min(left + width, u.valToPos(to, 'x', true))
            if (x1 <= x0) return
            u.ctx.save()
            u.ctx.fillStyle = color('--c-chart-year')
            u.ctx.fillRect(x0, top, x1 - x0, h)
            u.ctx.restore()
          },
        ],
        draw: [
          // The fixed y labels, at the grid lines just drawn.
          (u) => {
            const top = u.bbox.top / devicePixelRatio
            yCol.style.height = `${top + u.bbox.height / devicePixelRatio}px`
            yCol.replaceChildren(
              ...ySplits.map(({ value, label }) => {
                const span = document.createElement('span')
                span.textContent = label
                span.style.top = `${top + u.valToPos(value, 'y')}px`
                return span
              }),
            )
          },
          // Where a satellite of a charted series starts or stops in the data.
          (u) => {
            const { top, height: h } = u.bbox
            u.ctx.save()
            u.ctx.strokeStyle = muted
            u.ctx.setLineDash([4, 4])
            u.ctx.lineWidth = devicePixelRatio
            for (const m of markers) {
              const x = Math.round(u.valToPos(m.at, 'x', true))
              u.ctx.beginPath()
              u.ctx.moveTo(x, top)
              u.ctx.lineTo(x, top + h)
              u.ctx.stroke()
            }
            u.ctx.restore()
          },
        ],
      },
    }

    const u = new uPlot(opts, chartData(monthly) as uPlot.AlignedData, el)
    plot.current = u
    u.over.style.cursor = 'pointer'
    const onClick = () => {
      const idx = u.cursor.idx
      const picked = idx == null ? null : yearOfIndex(monthly, idx)
      if (picked) latest.current.onPickYear(picked)
    }
    u.over.addEventListener('click', onClick)
    setScrollable(initial.scrollable)
    // Fires once on observe, then on drawer open or resize: show the picked year
    // whenever the visible width changes (after uPlot has laid out).
    let seenWidth = -1
    let frame = 0
    const resize = new ResizeObserver(() => {
      const next = size()
      if (next.width !== u.width) u.setSize(next)
      setScrollable(next.scrollable)
      if (box.clientWidth === seenWidth || box.clientWidth === 0) return
      seenWidth = box.clientWidth
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => reveal(u, box, latest.current.year, 'auto'))
    })
    resize.observe(box)
    return () => {
      resize.disconnect()
      cancelAnimationFrame(frame)
      u.over.removeEventListener('click', onClick)
      u.destroy()
      plot.current = null
    }
  }, [monthly, manifest, lang, scheme, height, t, formatNumber])

  // A new picked year redraws the band and scrolls it into view.
  useEffect(() => {
    const u = plot.current
    if (!u) return
    u.redraw(false)
    if (year !== null) reveal(u, scroller.current!, year, 'smooth')
  }, [year])

  return (
    <div className="monthly-chart" aria-hidden="true">
      <div className="monthly-chart__frame">
        <div ref={scroller} className="monthly-chart__scroll">
          <div ref={container} />
        </div>
        <div ref={yLabels} className="monthly-chart__y" />
      </div>
      {scrollable && <p className="monthly-chart__hint">{t('chart.scroll')}</p>}
      <div ref={legend} />
    </div>
  )
}

/**
 * Scrolls the picked year into view (centred) unless it is already fully
 * visible; with no year picked, shows the latest months.
 */
function reveal(u: uPlot, box: HTMLElement, year: Year, behavior: ScrollBehavior) {
  if (box.scrollWidth <= box.clientWidth) return
  if (year === null) {
    box.scrollTo({ left: box.scrollWidth, behavior })
    return
  }
  const left = u.bbox.left / devicePixelRatio
  const [from, to] = yearSpan(year).map((v) => left + u.valToPos(v, 'x'))
  const view = { from: box.scrollLeft + Y_GUTTER, to: box.scrollLeft + box.clientWidth }
  if (from >= view.from && to <= view.to) return
  const room = box.clientWidth - Y_GUTTER
  box.scrollTo({ left: from - Y_GUTTER - Math.max(0, (room - (to - from)) / 2), behavior })
}
