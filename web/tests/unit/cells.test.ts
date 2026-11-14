import type { CellProperties, CellsCollection } from '../../src/data'
import {
  cellCategory,
  cellsSourceData,
  countCategory,
  indexCellRecords,
  isLowConfidenceOnly,
  otherViirsPlatforms,
} from '../../src/map/cells'
import * as fx from './data/fixtures'

const cell = (over: Partial<CellProperties>): CellProperties => ({
  ...(fx.cells().features[0].properties as CellProperties),
  ...over,
})

describe('cellCategory (sensor agreement, complete dates only)', () => {
  it.each([
    [{ n_active_days: 2, modis_days: 1, viirs_snpp_days: 1, viirs_all_days: 1 }, 'both'],
    [{ n_active_days: 1, modis_days: 1, viirs_snpp_days: 0, viirs_all_days: 0 }, 'modis'],
    [{ n_active_days: 1, modis_days: 0, viirs_snpp_days: 1, viirs_all_days: 1 }, 'viirs_snpp'],
    [{ n_active_days: 1, modis_days: 0, viirs_snpp_days: 0, viirs_all_days: 1 }, 'other_viirs'],
    [{ n_active_days: 0, modis_days: 0, viirs_snpp_days: 0, viirs_all_days: 0 }, 'partial'],
  ] as const)('%o → %s', (over, expected) => {
    expect(cellCategory(cell(over))).toBe(expected)
  })
})

describe('isLowConfidenceOnly', () => {
  it('looks at complete dates only', () => {
    expect(isLowConfidenceOnly(cell({ complete: [false, true], low_conf_only: [false, true] }))).toBe(true)
    expect(isLowConfidenceOnly(cell({ complete: [true, true], low_conf_only: [true, false] }))).toBe(false)
    expect(isLowConfidenceOnly(cell({ complete: [false], low_conf_only: [true] }))).toBe(false)
  })
})

describe('cellsSourceData', () => {
  it('keeps only flat properties for the map (no arrays)', () => {
    const data = cellsSourceData(fx.cells() as CellsCollection)
    const props = data.features[0].properties
    expect(props).toEqual({ cell_id: '55_10155', cat: 'both', low: false })
    expect(Object.values(props).some(Array.isArray)).toBe(false)
  })
})

describe('indexCellRecords', () => {
  it('keeps the arrays and the exported centre', () => {
    const rec = indexCellRecords(fx.cells() as CellsCollection).get('55_10155')!
    expect(rec.centre).toEqual([101.555, 0.555])
    expect(rec.properties.dates).toEqual(['2020-08-01', '2020-08-02'])
  })
})

describe('countCategory', () => {
  it('counts cells of one category', () => {
    expect(countCategory(fx.cells() as CellsCollection, 'both')).toBe(1)
    expect(countCategory(fx.cells() as CellsCollection, 'other_viirs')).toBe(0)
  })
})

describe('otherViirsPlatforms', () => {
  it('names the viirs_all satellites that are not in viirs_snpp, from the manifest', () => {
    expect(otherViirsPlatforms(fx.manifest() as never)).toBe('NOAA-20, NOAA-21')
  })

  it('follows the export (e.g. a NOAA-20-only series)', () => {
    const m = fx.manifest()
    m.series.viirs_all.platforms = ['snpp', 'noaa20']
    expect(otherViirsPlatforms(m as never)).toBe('NOAA-20')
  })
})
