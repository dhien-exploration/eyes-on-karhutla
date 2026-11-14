// Minimal documents that satisfy the v1 schemas, shaped like the real export
// (two WIB years: 2019 partial, 2020 complete; one province, Riau).

const totals = (modis: number, viirs_snpp: number, viirs_all: number) => ({ modis, viirs_snpp, viirs_all })

export const manifest = () => ({
  schema_version: '1.0.0',
  generated_at: '2026-10-26T15:30:46+00:00',
  pipeline: { package: 'eyes-on-karhutla', package_version: '0.2.0', git_commit: null },
  metric: { id: 'active_cell_days', label: 'Active cell-days', definition: '…', not: '…' },
  grid_deg: 0.01,
  day_convention: 'WIB (UTC+7) calendar date, nationwide',
  year_convention: 'WIB calendar year (1 Jan 00:00 to 31 Dec 23:59 WIB)',
  coverage: {
    periods: [{ start: '2019-01-01', end: '2020-12-31' }],
    first_date: '2019-01-01',
    last_date: '2020-12-31',
    years: { '2019': 'partial', '2020': 'complete' } as Record<string, 'complete' | 'partial' | 'missing'>,
    months: { '2019-01': 'partial', '2019-02': 'complete' } as Record<string, 'complete' | 'partial' | 'missing'>,
    partial_dates: ['2019-01-01'],
    trimmed: { dates: ['2021-01-01'], cell_days: 6, note: '…' },
    note: 'A date is covered only when every required source covers it.',
  },
  series: {
    modis: { label: 'MODIS (Terra + Aqua)', platforms: ['terra', 'aqua'], default: true, platform_periods: { terra: { start: '2019-01-01', end: null } } },
    viirs_snpp: { label: 'VIIRS S-NPP', platforms: ['snpp'], default: true, platform_periods: { snpp: { start: '2019-01-01', end: null } } },
    viirs_all: {
      label: 'VIIRS all satellites',
      platforms: ['snpp', 'noaa20', 'noaa21'],
      default: false,
      platform_periods: { snpp: { start: '2019-01-01', end: null }, noaa20: { start: '2019-01-01', end: null } },
    },
  },
  series_notes: { viirs_all: 'Adds NOAA-20 (2018-) and NOAA-21; the series jumps when they start.' },
  sources: [
    {
      source: 'MODIS_SP',
      required: true,
      utc_ranges: [{ start: '2019-01-01', end: '2020-12-31' }],
      files: [{ file: 'modis_sp/2019-01-01_2019-12-31.csv', start: '2019-01-01', end: '2019-12-31', raw_rows: 10, kept_rows: 9 }],
    },
  ],
  exclusions: [{ source: 'MODIS_SP', year: 2019, reason: 'non_vegetation_type', rows: 1 }],
  boundaries: {
    name: 'geoBoundaries',
    source: 'OSM',
    license: 'Open Data Commons Open Database License 1.0 (ODbL)',
    year_represented: 2017,
    url: 'https://www.geoboundaries.org/',
    n_provinces: 1,
    note: 'Province assigned by cell centre.',
  },
  totals: {
    indonesia: totals(5, 9, 12),
    indonesia_by_year: { '2019': totals(2, 3, 4), '2020': totals(3, 6, 8) } as Record<string, ReturnType<typeof totals>>,
    outside_provinces: totals(1, 2, 3),
    outside_provinces_by_year: { '2019': totals(1, 1, 1), '2020': totals(0, 1, 2) } as Record<string, ReturnType<typeof totals>>,
    note: 'Complete WIB dates only. Indonesia = sum of provinces.',
  },
  attribution: ['Fire detections: NASA FIRMS (MODIS Collection 6.1, VIIRS 375 m), https://firms.modaps.eosdis.nasa.gov/'],
  provinces: [
    {
      province_id: 'ID-RI',
      name: 'Riau',
      daily: 'provinces/ID-RI/daily.json',
      monthly: 'provinces/ID-RI/monthly.json',
      cells: { '2019': 'provinces/ID-RI/cells/2019.geojson', '2020': 'provinces/ID-RI/cells/2020.geojson' } as Record<string, string>,
    },
  ],
  files: {
    provinces: 'provinces.geojson',
    monthly: 'monthly.json',
    schemas: {
      manifest: 'schema/manifest.schema.json',
      provinces: 'schema/provinces.schema.json',
      daily: 'schema/daily.schema.json',
      monthly: 'schema/monthly.schema.json',
      cells: 'schema/cells.schema.json',
    },
  },
})

export const provinces = () => ({
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'MultiPolygon', coordinates: [[[[101, 0], [102, 0], [102, 1], [101, 0]]]] },
      properties: {
        province_id: 'ID-RI',
        name: 'Riau',
        totals: totals(5, 9, 12),
        totals_by_year: { '2019': totals(2, 3, 4), '2020': totals(3, 6, 8) } as Record<string, ReturnType<typeof totals>>,
        n_active_cells_by_year: { '2019': 1, '2020': 4 } as Record<string, number>,
      },
    },
  ],
})

export const daily = () => ({
  schema_version: '1.0.0',
  province_id: 'ID-RI',
  metric: 'active_cell_days',
  dates: ['2019-01-01', '2019-01-02', '2019-01-03'],
  status: ['partial', 'complete', 'complete'],
  modis: [0, 1, 1],
  viirs_snpp: [1, 2, 1] as (number | null)[],
  viirs_all: [1, 2, 2],
})

export const monthly = (provinceId: string | null = 'ID-RI') => ({
  schema_version: '1.0.0',
  province_id: provinceId,
  scope: provinceId === null ? 'indonesia' : 'province',
  metric: 'active_cell_days',
  months: ['2019-01', '2019-02', '2019-03'],
  status: ['partial', 'complete', 'missing'],
  modis: [3, 10, null] as (number | null)[],
  viirs_snpp: [8, 30, null] as (number | null)[],
  viirs_all: [9, 41, null] as (number | null)[],
})

export const cells = (year = 2020, provinceId = 'ID-RI') => ({
  type: 'FeatureCollection',
  schema_version: '1.0.0',
  province_id: provinceId,
  year,
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [101.555, 0.555] },
      properties: {
        cell_id: '55_10155',
        n_active_days: 1,
        modis_days: 1,
        viirs_snpp_days: 1,
        viirs_all_days: 1,
        first_date: `${year}-08-01`,
        last_date: `${year}-08-02`,
        dates: [`${year}-08-01`, `${year}-08-02`],
        complete: [false, true],
        modis: [false, true],
        viirs_snpp: [true, true],
        viirs_all: [true, true],
        low_conf_only: [false, false],
      },
    },
  ],
})
