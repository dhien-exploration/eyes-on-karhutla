import type { Manifest } from '../data'
import { COLOR_BY, type ColorBy } from '../map/choropleth'
import { coveredYears, type Year } from '../map/years'

// Shareable map views (lode/ui/share-links.md). A link only restores UI state from
// exported identifiers; it never changes or computes data.

export const VIEW_PARAMS = ['province', 'year', 'sensor', 'cell', 'other'] as const
export type ViewParam = (typeof VIEW_PARAMS)[number]

/** The parts of a view a link can carry. `undefined` = not given (the app's default applies). */
export interface View {
  province: string | null
  year: Year | undefined
  sensor: ColorBy | undefined
  cell: string | null
  other: boolean
}

export type RawView = Partial<Record<ViewParam, string>>

const ALL_YEARS = 'all'
const CELL_ID = /^\d+_\d+$/

/** The known view parameters of a query string, as given. */
export function readView(search: string): RawView {
  const params = new URLSearchParams(search)
  const raw: RawView = {}
  for (const key of VIEW_PARAMS) {
    const value = params.get(key)
    if (value !== null) raw[key] = value
  }
  return raw
}

/**
 * Checks raw parameters against the manifest. Invalid ones are dropped and listed in
 * `rejected`. A cell is only checked for shape here: whether it exists in the
 * province × year file is known once the cells load.
 */
export function resolveView(raw: RawView, manifest: Manifest): { view: View; rejected: ViewParam[] } {
  const rejected: ViewParam[] = []
  const view: View = { province: null, year: undefined, sensor: undefined, cell: null, other: false }

  if (raw.province !== undefined) {
    if (manifest.provinces.some((p) => p.province_id === raw.province)) view.province = raw.province
    else rejected.push('province')
  }
  if (raw.year !== undefined) {
    if (raw.year === ALL_YEARS) view.year = null
    else if (coveredYears(manifest).includes(raw.year)) view.year = raw.year
    else rejected.push('year')
  }
  if (raw.sensor !== undefined) {
    if ((COLOR_BY as readonly string[]).includes(raw.sensor)) view.sensor = raw.sensor as ColorBy
    else rejected.push('sensor')
  }
  if (raw.cell !== undefined) {
    // A dot belongs to one province and one year; "all years" has no dots.
    if (CELL_ID.test(raw.cell) && view.province !== null && view.year !== null) view.cell = raw.cell
    else rejected.push('cell')
  }
  if (raw.other !== undefined) {
    if (raw.other === '1' || raw.other === '0') view.other = raw.other === '1'
    else rejected.push('other')
  }
  return { view, rejected }
}

/** Query string (without `?`) for a view. Parts that are `undefined`, null or off are left out. */
export function viewQuery(view: View): string {
  const params = new URLSearchParams()
  if (view.province) params.set('province', view.province)
  if (view.year !== undefined) params.set('year', view.year ?? ALL_YEARS)
  if (view.sensor) params.set('sensor', view.sensor)
  if (view.province && view.cell) params.set('cell', view.cell)
  if (view.other) params.set('other', '1')
  return params.toString()
}

/** Absolute link to a view on the current page (path kept, hash dropped). */
export function viewUrl(view: View, location: Pick<Location, 'origin' | 'pathname'>): string {
  const query = viewQuery(view)
  return `${location.origin}${location.pathname}${query ? `?${query}` : ''}`
}

/** Local calendar date as YYYY-MM-DD. */
export function isoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export interface CitationParts {
  title: string
  place: string
  yearLabel: string
  seriesLabel: string
  metricLabel: string
  cellLabel: string | null
  accessedLabel: string
  exportLabel: string
  url: string
  accessed: Date
}

/** A reference to a view that records which export it showed (lode/ui/share-links.md). */
export function citation(manifest: Manifest, parts: CitationParts): string {
  const exportDate = manifest.generated_at.slice(0, 10)
  const commit = manifest.pipeline.git_commit ? ` (pipeline ${manifest.pipeline.git_commit.slice(0, 7)})` : ''
  const what = [parts.place, parts.yearLabel, parts.seriesLabel, parts.metricLabel, parts.cellLabel]
    .filter(Boolean)
    .join(', ')
  return (
    `${parts.title} (${exportDate.slice(0, 4)}). ${what}. ` +
    `Data: NASA FIRMS (MODIS, VIIRS), ${parts.exportLabel} ${exportDate}${commit}. ` +
    `${parts.accessedLabel} ${isoDate(parts.accessed)}. ${parts.url}`
  )
}

/** "All years" with the covered range, e.g. "Semua tahun (2012–2026)". */
export function allYearsLabel(manifest: Manifest, label: string): string {
  const years = coveredYears(manifest)
  return years.length ? `${label} (${years[0]}–${years.at(-1)})` : label
}
