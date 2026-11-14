import type { CellProperties, CellsCollection, Manifest } from '../data'

// Dot categories by sensor agreement (lode/map/cells.md). Built from the
// exported per-cell counts, which cover complete WIB dates only. A display
// grouping of exported values, not a new metric.
export type CellCategory = 'both' | 'modis' | 'viirs_snpp' | 'other_viirs' | 'partial'

export function cellCategory(p: CellProperties): CellCategory {
  if (p.n_active_days === 0) return 'partial'
  if (p.modis_days > 0 && p.viirs_snpp_days > 0) return 'both'
  if (p.modis_days > 0) return 'modis'
  if (p.viirs_snpp_days > 0) return 'viirs_snpp'
  return 'other_viirs'
}

/** Every complete date of the cell is flagged low-confidence only. */
export function isLowConfidenceOnly(p: CellProperties): boolean {
  const complete = p.complete.flatMap((c, i) => (c ? [p.low_conf_only[i]] : []))
  return complete.length > 0 && complete.every(Boolean)
}

/**
 * GeoJSON for the map with flat properties only (MapLibre stringifies arrays).
 * Per-date details are read from indexCells() instead.
 */
export function cellsSourceData(cells: CellsCollection) {
  return {
    type: 'FeatureCollection' as const,
    features: cells.features.map((f) => ({
      type: 'Feature' as const,
      geometry: f.geometry,
      properties: { cell_id: f.properties.cell_id, cat: cellCategory(f.properties), low: isLowConfidenceOnly(f.properties) },
    })),
  }
}

/** How many cells fall in a category (e.g. to state how many are hidden). */
export function countCategory(cells: CellsCollection, category: CellCategory): number {
  return cells.features.reduce((n, f) => n + (cellCategory(f.properties) === category ? 1 : 0), 0)
}

export const PLATFORM_NAMES: Record<string, string> = {
  terra: 'Terra',
  aqua: 'Aqua',
  snpp: 'S-NPP',
  noaa20: 'NOAA-20',
  noaa21: 'NOAA-21',
}

/** Display name of a platform id ("noaa20" → "NOAA-20"). */
export const platformName = (id: string): string => PLATFORM_NAMES[id] ?? id

/**
 * The satellites in `viirs_all` that are not in `viirs_snpp`, named for
 * display, e.g. "NOAA-20, NOAA-21". Follows whatever the export contains.
 */
export function otherViirsPlatforms(manifest: Manifest): string {
  const snpp = new Set<string>(manifest.series.viirs_snpp.platforms)
  return manifest.series.viirs_all.platforms
    .filter((p) => !snpp.has(p))
    .map((p) => PLATFORM_NAMES[p] ?? p)
    .join(', ')
}

export interface CellRecord {
  properties: CellProperties
  /** Exported cell centre, [lon, lat]. */
  centre: [number, number]
}

/**
 * Cells by cell_id with their per-date arrays and exported centre (the point
 * geometry, not derived from the id). MapLibre stringifies array properties on
 * queried features, so dot details are always read from here.
 */
export function indexCellRecords(cells: CellsCollection): Map<string, CellRecord> {
  return new Map(
    cells.features.map((f) => [f.properties.cell_id, { properties: f.properties, centre: f.geometry.coordinates }]),
  )
}
