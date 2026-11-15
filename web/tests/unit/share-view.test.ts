import type { Manifest } from '../../src/data'
import { allYearsLabel, citation, readView, resolveView, viewQuery, viewUrl, type View } from '../../src/share/view'
import * as fx from './data/fixtures'

const manifest = () => fx.manifest() as unknown as Manifest
const view = (v: Partial<View>): View => ({ province: null, year: undefined, sensor: undefined, cell: null, other: false, ...v })

describe('shareable views', () => {
  it('reads only the known parameters', () => {
    expect(readView('?province=ID-RI&year=2019&zoom=4&utm_source=x')).toEqual({ province: 'ID-RI', year: '2019' })
    expect(readView('')).toEqual({})
  })

  it('resolves a full link against the manifest', () => {
    const raw = readView('?province=ID-RI&year=2020&sensor=viirs_snpp&cell=55_10155&other=1')
    expect(resolveView(raw, manifest())).toEqual({
      view: { province: 'ID-RI', year: '2020', sensor: 'viirs_snpp', cell: '55_10155', other: true },
      rejected: [],
    })
  })

  it('reads year=all as all years', () => {
    expect(resolveView({ year: 'all' }, manifest()).view.year).toBeNull()
  })

  it('drops and lists invalid parts, keeping the rest', () => {
    const { view: v, rejected } = resolveView(
      { province: 'ID-XX', year: '1999', sensor: 'viirs_all', cell: '55_10155', other: 'yes' },
      manifest(),
    )
    expect(v).toEqual({ province: null, year: undefined, sensor: undefined, cell: null, other: false })
    // The cell needs a valid province; viirs_all never colours the map.
    expect(rejected).toEqual(['province', 'year', 'sensor', 'cell', 'other'])
  })

  it('rejects a dot for all years or with a malformed id', () => {
    expect(resolveView({ province: 'ID-RI', year: 'all', cell: '55_10155' }, manifest()).rejected).toEqual(['cell'])
    expect(resolveView({ province: 'ID-RI', cell: '55-10155' }, manifest()).rejected).toEqual(['cell'])
    // With no year in the link, the default year applies and the dot is kept.
    expect(resolveView({ province: 'ID-RI', cell: '55_10155' }, manifest()).view.cell).toBe('55_10155')
  })

  it('writes only what is set, and round-trips', () => {
    expect(viewQuery(view({}))).toBe('')
    expect(viewQuery(view({ year: null }))).toBe('year=all')
    const full = view({ province: 'ID-RI', year: '2020', sensor: 'modis', cell: '55_10155', other: true })
    const query = viewQuery(full)
    expect(query).toBe('province=ID-RI&year=2020&sensor=modis&cell=55_10155&other=1')
    expect(resolveView(readView(`?${query}`), manifest()).view).toEqual(full)
  })

  it('never writes a dot without its province', () => {
    expect(viewQuery(view({ cell: '55_10155', year: '2020' }))).toBe('year=2020')
  })

  it('builds an absolute link on the current page, without the hash', () => {
    expect(viewUrl(view({ province: 'ID-RI', year: '2019' }), { origin: 'https://example.org', pathname: '/map/' })).toBe(
      'https://example.org/map/?province=ID-RI&year=2019',
    )
    expect(viewUrl(view({}), { origin: 'https://example.org', pathname: '/' })).toBe('https://example.org/')
  })

  const parts = {
    title: 'Eyes on Karhutla',
    place: 'Riau',
    yearLabel: '2019',
    seriesLabel: 'VIIRS S-NPP',
    metricLabel: 'Active cell-days',
    cellLabel: null,
    exportLabel: 'export',
    accessedLabel: 'Accessed',
    url: 'https://example.org/?province=ID-RI&year=2019&sensor=viirs_snpp',
    accessed: new Date(2026, 10, 15, 9, 30),
  }

  it('cites a view with the export date and access date', () => {
    // The fixture export has no commit, so none is cited.
    expect(citation(manifest(), parts)).toBe(
      'Eyes on Karhutla (2026). Riau, 2019, VIIRS S-NPP, Active cell-days. ' +
        'Data: NASA FIRMS (MODIS, VIIRS), export 2026-10-26. Accessed 2026-11-15. ' +
        'https://example.org/?province=ID-RI&year=2019&sensor=viirs_snpp',
    )
  })

  it('cites the pipeline commit and a picked dot when there is one', () => {
    const m = manifest()
    m.pipeline.git_commit = '65374d91cd8a80f48df58514b5f710f7e0b8a457'
    const text = citation(m, { ...parts, cellLabel: 'cell 55_10155' })
    expect(text).toContain('Riau, 2019, VIIRS S-NPP, Active cell-days, cell 55_10155.')
    expect(text).toContain('export 2026-10-26 (pipeline 65374d9).')
  })

  it('labels all years with the covered range', () => {
    expect(allYearsLabel(manifest(), 'All years')).toBe('All years (2019–2020)')
  })
})
