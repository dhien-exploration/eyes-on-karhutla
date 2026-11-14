import { linkify, parseAttribution, shortDataCredits } from '../../src/map/attribution'
import * as fx from './data/fixtures'

describe('parseAttribution', () => {
  it("turns OpenFreeMap's TileJSON credit into text and links", () => {
    const html =
      '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>'
    expect(parseAttribution(html)).toEqual([
      { text: 'OpenFreeMap', href: 'https://openfreemap.org' },
      { text: '© OpenMapTiles', href: 'https://www.openmaptiles.org/' },
      { text: 'Data from' },
      { text: 'OpenStreetMap', href: 'https://www.openstreetmap.org/copyright' },
    ])
  })

  it('never keeps scripts or non-web links', () => {
    const parts = parseAttribution('<a href="javascript:alert(1)">x</a><script>alert(1)</script><img src=x onerror=alert(1)>ok')
    expect(parts).toEqual([{ text: 'x' }, { text: 'alert(1)' }, { text: 'ok' }])
  })
})

describe('shortDataCredits', () => {
  it('names NASA FIRMS and the boundary source with its licence, linked from the manifest', () => {
    const m = fx.manifest()
    m.attribution = ['Fire detections: NASA FIRMS (MODIS Collection 6.1, VIIRS 375 m), https://firms.modaps.eosdis.nasa.gov/']
    m.boundaries.license = 'Open Data Commons Open Database License 1.0 (ODbL)'
    expect(shortDataCredits(m as never)).toEqual([
      [{ text: 'NASA FIRMS', href: 'https://firms.modaps.eosdis.nasa.gov/' }],
      [{ text: 'geoBoundaries (ODbL)', href: 'https://www.geoboundaries.org/' }],
    ])
  })
})

describe('linkify', () => {
  it('links bare URLs inside a credit string', () => {
    expect(linkify('Fire detections: NASA FIRMS, https://firms.modaps.eosdis.nasa.gov/')).toEqual([
      { text: 'Fire detections: NASA FIRMS, ' },
      { text: 'https://firms.modaps.eosdis.nasa.gov/', href: 'https://firms.modaps.eosdis.nasa.gov/' },
    ])
  })
})
