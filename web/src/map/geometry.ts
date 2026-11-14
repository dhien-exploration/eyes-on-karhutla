import type { ProvincesCollection } from '../data'

type ProvinceGeometry = ProvincesCollection['features'][number]['geometry']

/** [[west, south], [east, north]] in degrees. */
export type Bounds = [[number, number], [number, number]]

/** Screen space covered by floating UI, in pixels; the map keeps Indonesia clear of it. */
export interface Insets {
  top: number
  right: number
  bottom: number
  left: number
}

/** The whole country. */
export const INDONESIA_VIEW: Bounds = [
  [94.7, -11.2],
  [141.1, 6.3],
]

// Web Mercator in unit space: x and y in [0, 1], y growing southwards.
const mercX = (lon: number) => (lon + 180) / 360
const mercY = (lat: number) => (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360
const lonOf = (x: number) => x * 360 - 180
const latOf = (y: number) => (360 / Math.PI) * Math.atan(Math.exp(((180 - y * 360) * Math.PI) / 180)) - 90

/**
 * The pan limit for a viewport (AGENTS.md section 4.1): the box that, when it
 * exactly fills a `width` × `height` map, shows `area` as large as possible
 * inside the part not covered by `insets`. Used as MapLibre `maxBounds`: at the
 * widest zoom the whole country is visible and nothing can be panned; zoomed in,
 * panning stays inside this box.
 */
export function viewportBounds(area: Bounds, width: number, height: number, insets: Insets): Bounds {
  const [[west, south], [east, north]] = area
  const x0 = mercX(west)
  const x1 = mercX(east)
  const y0 = mercY(north)
  const y1 = mercY(south)
  const freeW = Math.max(1, width - insets.left - insets.right)
  const freeH = Math.max(1, height - insets.top - insets.bottom)
  // Pixels per Mercator unit at the zoom where the area just fits the free space.
  const scale = Math.min(freeW / (x1 - x0), freeH / (y1 - y0))
  const extraX = (freeW / scale - (x1 - x0)) / 2
  const extraY = (freeH / scale - (y1 - y0)) / 2
  return [
    [lonOf(x0 - extraX - insets.left / scale), latOf(y1 + extraY + insets.bottom / scale)],
    [lonOf(x1 + extraX + insets.right / scale), latOf(y0 - extraY - insets.top / scale)],
  ]
}

/** MapLibre's tile size: the world is 512 · 2^zoom px wide. */
const TILE_SIZE = 512

/**
 * The centre closest to `center` at which a `width` × `height` view at `zoom`
 * stays inside `limit` (as MapLibre's maxBounds would force it). On an axis
 * where the view is larger than the limit, it centres on the limit. Used to
 * animate straight to where the camera will end up, instead of letting maxBounds
 * snap it there afterwards.
 */
export function clampCenter(
  limit: Bounds,
  center: [number, number],
  zoom: number,
  width: number,
  height: number,
): [number, number] {
  const [[west, south], [east, north]] = limit
  const world = TILE_SIZE * 2 ** zoom
  const halfW = width / 2 / world
  const halfH = height / 2 / world
  const fit = (v: number, lo: number, hi: number, half: number) =>
    hi - lo <= 2 * half ? (lo + hi) / 2 : Math.min(Math.max(v, lo + half), hi - half)
  const x = fit(mercX(center[0]), mercX(west), mercX(east), halfW)
  const y = fit(mercY(center[1]), mercY(north), mercY(south), halfH)
  return [lonOf(x), latOf(y)]
}

/** Bounding box of a province's display polygon, for zooming the camera to it. */
export function geometryBounds(geometry: ProvinceGeometry): Bounds {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity
  for (const polygon of polygons) {
    for (const [lon, lat] of polygon[0]) {
      west = Math.min(west, lon)
      east = Math.max(east, lon)
      south = Math.min(south, lat)
      north = Math.max(north, lat)
    }
  }
  return [
    [west, south],
    [east, north],
  ]
}

/**
 * A plain rectangle for the dimming layer drawn between the basemap and the
 * provinces. (A rectangle with every province cut out as a hole does not work:
 * neighbouring provinces share edges, and touching holes tessellate into wedges.)
 */
export function maskFrame(frame: Bounds) {
  const [[w, s], [e, n]] = frame
  return {
    type: 'Feature' as const,
    properties: {},
    geometry: {
      type: 'Polygon' as const,
      coordinates: [
        [
          [w, s],
          [e, s],
          [e, n],
          [w, n],
          [w, s],
        ],
      ],
    },
  }
}
