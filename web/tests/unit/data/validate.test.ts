import { DataError } from '../../../src/data'
import { parseCells, parseDaily, parseManifest, parseMonthly, parseProvinces } from '../../../src/data/validate'
import * as fx from './fixtures'

function errorOf(fn: () => unknown): DataError {
  try {
    fn()
  } catch (e) {
    if (e instanceof DataError) return e
    throw e
  }
  throw new Error('expected a DataError')
}

describe('valid documents', () => {
  it('pass through unchanged', () => {
    expect(parseManifest(fx.manifest())).toEqual(fx.manifest())
    expect(parseProvinces(fx.provinces(), 'provinces.geojson')).toEqual(fx.provinces())
    expect(parseDaily(fx.daily(), 'd.json', 'ID-RI')).toEqual(fx.daily())
    expect(parseCells(fx.cells(), 'c.geojson', 'ID-RI', '2020')).toEqual(fx.cells())
    expect(parseMonthly(fx.monthly(), 'm.json', 'ID-RI')).toEqual(fx.monthly())
    expect(parseMonthly(fx.monthly(null), 'monthly.json', null)).toEqual(fx.monthly(null))
    expect(parseProvinces(fx.provinces(), 'p.geojson', fx.manifest() as never)).toEqual(fx.provinces())
  })

  it('accept a province with no activity (empty FeatureCollection)', () => {
    const empty = { ...fx.cells(), features: [] }
    expect(parseCells(empty, 'c.geojson', 'ID-RI', '2020').features).toHaveLength(0)
  })
})

describe('schema errors', () => {
  it('reject an unknown schema version', () => {
    const err = errorOf(() => parseManifest({ ...fx.manifest(), schema_version: '3.0.0' }))
    expect(err.kind).toBe('schema')
    expect(err.file).toBe('manifest.json')
    expect(err.message).toContain('/schema_version')
  })

  it('reject a missing required field', () => {
    const { metric: _metric, ...rest } = fx.manifest()
    expect(errorOf(() => parseManifest(rest)).kind).toBe('schema')
  })

  it('reject a malformed date', () => {
    const d = fx.daily()
    d.dates[1] = '2019/08/02'
    expect(errorOf(() => parseDaily(d, 'd.json', 'ID-RI')).kind).toBe('schema')
  })

  it('reject negative counts', () => {
    const d = fx.daily()
    d.modis[0] = -1
    expect(errorOf(() => parseDaily(d, 'd.json', 'ID-RI')).kind).toBe('schema')
  })
})

describe('contract errors (rules the schemas cannot express)', () => {
  it('reject daily arrays of unequal length', () => {
    const d = fx.daily()
    d.viirs_snpp.pop()
    const err = errorOf(() => parseDaily(d, 'd.json', 'ID-RI'))
    expect(err.kind).toBe('contract')
    expect(err.message).toContain('viirs_snpp has 2 entries but dates has 3')
  })

  it('reject a daily file for another province', () => {
    expect(errorOf(() => parseDaily(fx.daily(), 'd.json', 'ID-KT')).kind).toBe('contract')
  })

  it('reject cell arrays of unequal length and name the cell', () => {
    const c = fx.cells()
    c.features[0].properties.low_conf_only.push(true)
    const err = errorOf(() => parseCells(c, 'c.geojson', 'ID-RI', '2020'))
    expect(err.kind).toBe('contract')
    expect(err.message).toContain('cell 55_10155')
  })

  it('reject a cells file for another year or province', () => {
    expect(errorOf(() => parseCells(fx.cells(2019), 'c.geojson', 'ID-RI', '2020')).kind).toBe('contract')
    expect(errorOf(() => parseCells(fx.cells(2020, 'ID-KT'), 'c.geojson', 'ID-RI', '2020')).kind).toBe('contract')
  })

  it('reject a monthly file of the wrong scope', () => {
    expect(errorOf(() => parseMonthly(fx.monthly('ID-RI'), 'monthly.json', null)).kind).toBe('contract')
  })

  it('reject monthly arrays of unequal length', () => {
    const m = fx.monthly()
    m.viirs_snpp.pop()
    expect(errorOf(() => parseMonthly(m, 'm.json', 'ID-RI')).message).toContain('monthly series')
  })

  it('reject provinces without totals for a covered year', () => {
    const p = fx.provinces()
    delete p.features[0].properties.totals_by_year['2020']
    const err = errorOf(() => parseProvinces(p, 'provinces.geojson', fx.manifest() as never))
    expect(err.kind).toBe('contract')
    expect(err.message).toContain('ID-RI has no 2020 totals')
  })
})

describe('missing ≠ zero', () => {
  it('accepts null counts for missing months and dates', () => {
    expect(parseMonthly(fx.monthly(), 'm.json', 'ID-RI').modis[2]).toBeNull()
    const d = fx.daily()
    d.viirs_snpp[0] = null
    expect(parseDaily(d, 'd.json', 'ID-RI').viirs_snpp[0]).toBeNull()
  })
})
