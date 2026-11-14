import type { Manifest, ProvincesCollection } from '../data'

// Year selection over the multi-year data (lode/plans/multi-year.md). `null` = "Semua tahun"
// (all years). Every figure comes from an exported total for that year; nothing
// is summed here (AGENTS.md: no re-aggregation in the browser).
export type Year = string | null

type Province = ProvincesCollection['features'][number]['properties']
type Totals = Province['totals']
export type YearStatus = Manifest['coverage']['years'][string]

/** Covered WIB years, oldest first. */
export function coveredYears(manifest: Manifest): string[] {
  return Object.keys(manifest.coverage.years).sort()
}

/** The year the app opens on: the latest complete year, else the latest covered year. */
export function defaultYear(manifest: Manifest): Year {
  const years = coveredYears(manifest)
  const complete = years.filter((y) => manifest.coverage.years[y] === 'complete')
  return complete.at(-1) ?? years.at(-1) ?? null
}

export function yearStatus(manifest: Manifest, year: Year): YearStatus | null {
  return year === null ? null : (manifest.coverage.years[year] ?? null)
}

export function provinceTotals(p: Province, year: Year): Totals {
  return year === null ? p.totals : p.totals_by_year[year]
}

/** Active cells of a province in a year; not exported for all years combined. */
export function provinceActiveCells(p: Province, year: Year): number | null {
  return year === null ? null : p.n_active_cells_by_year[year]
}

/** Indonesia = sum of the provinces (exported); outside provinces is separate. */
export function indonesiaTotals(manifest: Manifest, year: Year): Totals {
  return year === null ? manifest.totals.indonesia : manifest.totals.indonesia_by_year[year]
}

export function outsideTotals(manifest: Manifest, year: Year): Totals {
  return year === null ? manifest.totals.outside_provinces : manifest.totals.outside_provinces_by_year[year]
}

/**
 * Values that define the choropleth classes. For a single year: every province
 * in every year, so one scale per sensor is fixed across years and crisis years
 * stand out. For all years: the all-years totals (a different magnitude).
 */
export function scaleValues(provinces: Province[], series: 'modis' | 'viirs_snpp', year: Year): number[] {
  if (year === null) return provinces.map((p) => p.totals[series])
  return provinces.flatMap((p) => Object.values(p.totals_by_year).map((t) => t[series]))
}
