import { INDONESIA_VIEW, clampCenter, geometryBounds, maskFrame, viewportBounds, type Bounds } from '../../src/map/geometry'

describe('geometryBounds', () => {
  it('spans every polygon of a MultiPolygon', () => {
    const bounds = geometryBounds({
      type: 'MultiPolygon',
      coordinates: [
        [[[101, 0], [102, 0], [102, 1], [101, 0]]],
        [[[104, -2], [105, -2], [105, -1], [104, -2]]],
      ],
    })
    expect(bounds).toEqual([
      [101, -2],
      [105, 1],
    ])
  })

  it('handles a single Polygon', () => {
    const bounds = geometryBounds({ type: 'Polygon', coordinates: [[[110, -3], [112, -3], [112, -1], [110, -3]]] })
    expect(bounds).toEqual([
      [110, -3],
      [112, -1],
    ])
  })
})

const mercX = (lon: number) => (lon + 180) / 360
const mercY = (lat: number) => (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360
const size = ([[w, s], [e, n]]: Bounds) => [mercX(e) - mercX(w), mercY(s) - mercY(n)]

describe('viewportBounds', () => {
  const none = { top: 0, right: 0, bottom: 0, left: 0 }

  it('contains the whole area and matches the viewport aspect ratio', () => {
    const box = viewportBounds(INDONESIA_VIEW, 1440, 900, none)
    const [[w, s], [e, n]] = box
    expect(w).toBeLessThanOrEqual(94.7)
    expect(e).toBeGreaterThanOrEqual(141.1)
    expect(s).toBeLessThanOrEqual(-11.2)
    expect(n).toBeGreaterThanOrEqual(6.3)
    const [bw, bh] = size(box)
    expect(bw / bh).toBeCloseTo(1440 / 900, 6)
  })

  it('is exactly the area on the limiting axis (no room to pan at the widest zoom)', () => {
    // Indonesia is wider than 1440×900, so width is the limiting axis.
    const [[w], [e]] = viewportBounds(INDONESIA_VIEW, 1440, 900, none)
    expect(w).toBeCloseTo(94.7, 6)
    expect(e).toBeCloseTo(141.1, 6)
  })

  it('extends past the area under the overlays so Indonesia stays clear of them', () => {
    const insets = { top: 80, right: 368, bottom: 28, left: 0 }
    const box = viewportBounds(INDONESIA_VIEW, 1440, 900, insets)
    const [bw] = size(box)
    const pxPerUnit = 1440 / bw
    // The right inset maps to the space east of Indonesia's edge.
    const eastOfArea = (mercX(box[1][0]) - mercX(141.1)) * pxPerUnit
    expect(eastOfArea).toBeGreaterThanOrEqual(368 - 1e-6)
    expect(box[1][0]).toBeGreaterThan(141.1)
  })

  it('is taller than wide on a phone, still fitting the whole width', () => {
    const box = viewportBounds(INDONESIA_VIEW, 390, 844, none)
    const [bw, bh] = size(box)
    expect(bh).toBeGreaterThan(bw)
    expect(box[0][0]).toBeCloseTo(94.7, 6)
  })
})

describe('maskFrame', () => {
  it('is a closed rectangle with no holes', () => {
    const f = maskFrame([
      [60, -45],
      [180, 40],
    ])
    expect(f.geometry.coordinates).toHaveLength(1)
    const ring = f.geometry.coordinates[0]
    expect(ring[0]).toEqual(ring[ring.length - 1])
  })
})

describe('clampCenter', () => {
  const limit = viewportBounds(INDONESIA_VIEW, 1440, 900, { top: 0, right: 0, bottom: 0, left: 0 })
  const zoom = 7
  const halfWidthDeg = (1440 / 2 / (512 * 2 ** zoom)) * 360

  it('keeps a centre that already fits', () => {
    const [lon, lat] = clampCenter(limit, [113, -1], zoom, 1440, 900)
    expect(lon).toBeCloseTo(113, 6)
    expect(lat).toBeCloseTo(-1, 6)
  })

  it('moves an edge centre (Aceh) in until the view touches the limit', () => {
    const [lon] = clampCenter(limit, [96.6, 3.9], zoom, 1440, 900)
    expect(lon).toBeCloseTo(94.7 + halfWidthDeg, 6)
  })

  it('moves an east-edge centre (Papua) in too', () => {
    const [lon] = clampCenter(limit, [140, -4], zoom, 1440, 900)
    expect(lon).toBeCloseTo(141.1 - halfWidthDeg, 6)
  })

  it('centres on the limit when the view is larger than it', () => {
    const [lon] = clampCenter(limit, [100, 0], 1, 1440, 900)
    expect(lon).toBeCloseTo((94.7 + 141.1) / 2, 6)
  })
})
