import 'maplibre-gl/dist/maplibre-gl.css'
import {
  type IControl,
  LngLat,
  Map as MapLibreMap,
  NavigationControl,
  setWorkerUrl,
  type ExpressionSpecification,
} from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { useEffect, useRef } from 'react'
import type { CellsCollection, ProvincesCollection } from '../data'
import { BASEMAP_STYLES, useColorScheme } from './basemap'
import { cellsSourceData } from './cells'
import { provinceTotals, type Year } from './years'
import { fillColorExpression, type ChoroplethScale } from './choropleth'
import { INDONESIA_VIEW, clampCenter, geometryBounds, maskFrame, viewportBounds, type Bounds, type Insets } from './geometry'

setWorkerUrl(workerUrl)

export interface ProvinceHover {
  provinceId: string
  /** Pointer position in pixels, relative to the map container. */
  x: number
  y: number
  /** True when the pointer is near the right edge, so a card should open to the left. */
  nearRightEdge: boolean
}

interface Props {
  provinces: ProvincesCollection
  /** Receives the basemap's own attribution HTML (from its tile metadata) whenever it changes. */
  onBasemapCredits: (html: string[]) => void
  selectedId: string | null
  /** Province shading: one series at a time. */
  scale: ChoroplethScale
  /** Year whose exported totals shade the provinces (null = all years). */
  year: Year
  /** Screen space covered by floating UI; Indonesia is kept clear of it. */
  insets: Insets
  onSelect: (provinceId: string) => void
  onHover: (hover: ProvinceHover | null) => void
  /** Active cells of the selected province (null: no dots). */
  cells: CellsCollection | null
  /** Also draw cells seen only by other VIIRS satellites (opt-in). */
  showOtherViirs: boolean
  selectedCellId: string | null
  /** A dot was clicked (its cell_id), or null when clicking elsewhere in the selected province. */
  onCellSelect: (cellId: string | null) => void
  label: string
  /** Accessible name of the reset-view button. */
  resetLabel: string
  /** Reset-view button with a province selected: clear the selection (the camera then flies back). */
  onReset: () => void
}

/** A MapLibre control (above the zoom buttons) that flies back to the starting Indonesia view. */
class ResetViewControl implements IControl {
  private container = document.createElement('div')
  readonly button = document.createElement('button')

  constructor(onReset: () => void) {
    this.container.className = 'maplibregl-ctrl maplibregl-ctrl-group reset-view'
    this.button.type = 'button'
    // Lucide "fullscreen" icon (https://lucide.dev/icons/fullscreen).
    // ISC License, Copyright (c) 2026 Lucide Icons and Contributors.
    this.button.innerHTML =
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/>' +
      '<path d="M7 21H5a2 2 0 0 1-2-2v-2"/><rect width="10" height="8" x="7" y="8" rx="1"/></svg>'
    this.button.addEventListener('click', onReset)
    this.container.append(this.button)
  }

  setLabel(label: string) {
    this.button.title = label
    this.button.setAttribute('aria-label', label)
  }

  onAdd() {
    return this.container
  }

  onRemove() {
    this.container.remove()
  }
}

const SOURCE = 'provinces'
const MASK_SOURCE = 'outside-mask'
const MASK = 'outside-mask'
const FILL = 'provinces-fill'
const LINE = 'provinces-line'
const CELLS_SOURCE = 'cells'
const DOTS = 'cells-dot'
const RINGS = 'cells-ring'
const PICKED = 'cells-selected'
const OWN_SOURCES = new Set([SOURCE, MASK_SOURCE, CELLS_SOURCE])
const EMPTY = { type: 'FeatureCollection' as const, features: [] }

// Dot radius by zoom; `extra` px is added at every stop (MapLibre only allows
// "zoom" at the top of an interpolate, so it cannot be wrapped in a sum).
const dotRadius = (extra = 0): ExpressionSpecification => [
  'interpolate', ['linear'], ['zoom'],
  4, 1.4 + extra, 7, 2.2 + extra, 9, 3.4 + extra, 11, 5.5 + extra, 13, 9 + extra,
]
const ringFilter = (showOtherViirs: boolean): ExpressionSpecification =>
  showOtherViirs ? ['in', ['get', 'cat'], ['literal', ['partial', 'other_viirs']]] : ['==', ['get', 'cat'], 'partial']
const pickedFilter = (cellId: string | null): ExpressionSpecification => ['==', ['get', 'cell_id'], cellId ?? '']
/** Region dimmed around Indonesia; larger than any pan limit. */
const MASK_FRAME: Bounds = [
  [60, -45],
  [180, 40],
]

const isSelected: ExpressionSpecification = ['boolean', ['feature-state', 'selected'], false]
const isHovered: ExpressionSpecification = ['boolean', ['feature-state', 'hover'], false]

function cssColor(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

// MapLibre stringifies nested properties, so the picked year's exported totals
// used for shading are copied to flat `total_<series>` properties (values unchanged).
function sourceData(provinces: ProvincesCollection, year: Year) {
  return {
    ...provinces,
    features: provinces.features.map((f) => {
      const totals = provinceTotals(f.properties, year)
      return {
        ...f,
        properties: { province_id: f.properties.province_id, total_modis: totals.modis, total_viirs_snpp: totals.viirs_snpp },
      }
    }),
  }
}

export function IndonesiaMap(props: Props) {
  const { provinces, selectedId, scale, year, insets, cells, showOtherViirs, selectedCellId, label, resetLabel } = props
  const resetControl = useRef<ResetViewControl | null>(null)
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const scheme = useColorScheme()

  // Latest props for MapLibre's long-lived event handlers.
  const latest = useRef(props)
  latest.current = props

  const panLimit = (): Bounds => {
    const el = container.current!
    return viewportBounds(INDONESIA_VIEW, el.clientWidth, el.clientHeight, latest.current.insets)
  }

  useEffect(() => {
    const limit = panLimit()
    const map = new MapLibreMap({
      container: container.current!,
      style: BASEMAP_STYLES[scheme],
      bounds: limit,
      // The pan limit is sized to the viewport, so it also sets the widest zoom.
      maxBounds: limit,
      minZoom: 0,
      maxZoom: 13,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      attributionControl: false,
    })
    mapRef.current = map
    map.touchZoomRotate.disableRotation()
    map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right')
    // Added after the zoom buttons, so MapLibre stacks it above them. With a
    // province selected it clears the selection, and the camera effect flies back
    // to Indonesia. Otherwise it flies back itself.
    const reset = new ResetViewControl(() => {
      if (latest.current.selectedId) latest.current.onReset()
      else map.fitBounds(panLimit(), { padding: 0, duration: reducedMotion() ? 0 : 1000 })
    })
    reset.setLabel(latest.current.resetLabel)
    map.addControl(reset, 'bottom-right')
    resetControl.current = reset
    // No MapLibre attribution box: the app's own sources line shows every credit.
    // The basemap's credit is still read from its tile metadata, so it stays right
    // if the basemap changes.
    let credits = ''
    map.on('sourcedata', () => {
      const html = Object.keys(map.getStyle().sources)
        .filter((id) => !OWN_SOURCES.has(id))
        .map((id) => (map.getSource(id) as { attribution?: string } | undefined)?.attribution)
        .filter((a): a is string => !!a)
      const unique = [...new Set(html)]
      if (unique.join('|') !== credits) {
        credits = unique.join('|')
        latest.current.onBasemapCredits(unique)
      }
    })
    if (import.meta.env.DEV) (window as unknown as { __eokMap?: MapLibreMap }).__eokMap = map

    // Runs on first load and again after every basemap swap (setStyle drops our layers).
    map.on('style.load', () => {
      // Layer order, bottom to top: basemap shapes → mask → provinces → basemap labels.
      // The mask flattens everything that is not Indonesian land; the coloured
      // provinces sit on it; labels stay readable on top of both.
      const layers = map.getStyle().layers
      const beforeId = layers.find((l) => l.type === 'symbol')?.id
      // Basemap text must stay readable on every choropleth shade: one high-contrast
      // text colour with a strong halo per theme.
      for (const layer of layers) {
        if (layer.type !== 'symbol' || !layer.layout?.['text-field']) continue
        map.setPaintProperty(layer.id, 'text-color', cssColor('--c-map-label'))
        map.setPaintProperty(layer.id, 'text-halo-color', cssColor('--c-map-label-halo'))
        map.setPaintProperty(layer.id, 'text-halo-width', 1.4)
        map.setPaintProperty(layer.id, 'text-halo-blur', 0.3)
      }
      map.addSource(MASK_SOURCE, { type: 'geojson', data: maskFrame(MASK_FRAME) })
      map.addLayer(
        { id: MASK, type: 'fill', source: MASK_SOURCE, paint: { 'fill-color': cssColor('--c-map-mask'), 'fill-opacity': 0.78 } },
        beforeId,
      )
      map.addSource(SOURCE, { type: 'geojson', data: sourceData(latest.current.provinces, latest.current.year), promoteId: 'province_id' })
      const accent = cssColor('--c-map-selected')
      map.addLayer(
        {
          id: FILL,
          type: 'fill',
          source: SOURCE,
          paint: {
            'fill-color': fillColorExpression(latest.current.scale),
            // The selected province fades so its dots read clearly.
            'fill-opacity': ['case', isSelected, 0.2, isHovered, 0.95, 0.85],
          },
        },
        beforeId,
      )
      map.addLayer(
        {
          id: LINE,
          type: 'line',
          source: SOURCE,
          paint: {
            'line-color': ['case', ['any', isSelected, isHovered], accent, cssColor('--c-map-line')],
            'line-width': ['case', isSelected, 3, isHovered, 1.8, 0.6],
          },
        },
        beforeId,
      )
      // Cell dots (lode/map/cells.md): coloured by sensor agreement; partial-only
      // and other-VIIRS-only cells as hollow rings; low-confidence-only fainter.
      const dotColor: ExpressionSpecification = [
        'match', ['get', 'cat'],
        'both', cssColor('--c-both'),
        'modis', cssColor('--c-modis'),
        'viirs_snpp', cssColor('--c-viirs'),
        cssColor('--c-muted'),
      ]
      const { cells, showOtherViirs, selectedCellId } = latest.current
      map.addSource(CELLS_SOURCE, { type: 'geojson', data: cells ? cellsSourceData(cells) : EMPTY })
      map.addLayer(
        {
          id: DOTS,
          type: 'circle',
          source: CELLS_SOURCE,
          filter: ['in', ['get', 'cat'], ['literal', ['both', 'modis', 'viirs_snpp']]],
          paint: {
            'circle-radius': dotRadius(),
            'circle-color': dotColor,
            'circle-opacity': ['case', ['get', 'low'], 0.4, 0.92],
            'circle-stroke-color': cssColor('--c-map-dot-stroke'),
            'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 7, 0, 10, 0.8],
          },
        },
        beforeId,
      )
      map.addLayer(
        {
          id: RINGS,
          type: 'circle',
          source: CELLS_SOURCE,
          filter: ringFilter(showOtherViirs),
          paint: {
            'circle-radius': dotRadius(),
            'circle-color': 'rgba(0,0,0,0)',
            'circle-stroke-color': ['match', ['get', 'cat'], 'other_viirs', cssColor('--c-viirs'), cssColor('--c-map-partial')],
            'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 5, 0.8, 10, 1.6],
            'circle-stroke-opacity': ['case', ['get', 'low'], 0.5, 1],
          },
        },
        beforeId,
      )
      map.addLayer(
        {
          id: PICKED,
          type: 'circle',
          source: CELLS_SOURCE,
          filter: pickedFilter(selectedCellId),
          paint: {
            'circle-radius': dotRadius(5),
            'circle-color': 'rgba(0,0,0,0)',
            'circle-stroke-color': accent,
            'circle-stroke-width': 2.5,
          },
        },
        beforeId,
      )
      const { selectedId } = latest.current
      if (selectedId) map.setFeatureState({ source: SOURCE, id: selectedId }, { selected: true })
    })

    // The pan limit follows the window size.
    map.on('resize', () => map.setMaxBounds(panLimit()))

    let hoveredId: string | null = null
    const setHovered = (id: string | null) => {
      if (id === hoveredId) return
      if (hoveredId) map.setFeatureState({ source: SOURCE, id: hoveredId }, { hover: false })
      if (id) map.setFeatureState({ source: SOURCE, id }, { hover: true })
      hoveredId = id
      map.getCanvas().style.cursor = id ? 'pointer' : ''
    }

    // Dots are tiny, so they are hit-tested in a small box around the pointer.
    const dotAt = (x: number, y: number): string | undefined => {
      const layers = [DOTS, RINGS].filter((id) => map.getLayer(id))
      if (!layers.length) return undefined
      const hit = map.queryRenderedFeatures(
        [
          [x - 5, y - 5],
          [x + 5, y + 5],
        ],
        { layers },
      )
      return hit[0]?.properties.cell_id as string | undefined
    }

    map.on('mousemove', (e) => {
      const onDot = dotAt(e.point.x, e.point.y) !== undefined
      const province = map.getLayer(FILL) ? map.queryRenderedFeatures(e.point, { layers: [FILL] })[0] : undefined
      const id = province?.properties.province_id as string | undefined
      setHovered(id ?? null)
      if (onDot) map.getCanvas().style.cursor = 'pointer'
      // No hover card over the province already open in the drawer.
      const showCard = id && id !== latest.current.selectedId
      const nearRightEdge = e.point.x > map.getContainer().clientWidth - latest.current.insets.right - 320
      latest.current.onHover(showCard ? { provinceId: id, x: e.point.x, y: e.point.y, nearRightEdge } : null)
    })
    map.on('mouseout', () => {
      setHovered(null)
      latest.current.onHover(null)
    })
    // A dot wins over the province underneath it.
    map.on('click', (e) => {
      const cellId = dotAt(e.point.x, e.point.y)
      if (cellId) return latest.current.onCellSelect(cellId)
      const province = map.getLayer(FILL) ? map.queryRenderedFeatures(e.point, { layers: [FILL] })[0] : undefined
      const id = province?.properties.province_id as string | undefined
      if (!id) return
      if (id === latest.current.selectedId) latest.current.onCellSelect(null)
      else latest.current.onSelect(id)
    })

    return () => {
      map.remove()
      mapRef.current = null
    }
    // The map is created once; later prop changes are applied by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The reset button's name follows the language.
  useEffect(() => {
    resetControl.current?.setLabel(resetLabel)
  }, [resetLabel])

  // Basemap follows light/dark mode.
  const firstScheme = useRef(scheme)
  useEffect(() => {
    if (scheme === firstScheme.current) return
    firstScheme.current = scheme
    mapRef.current?.setStyle(BASEMAP_STYLES[scheme])
  }, [scheme])

  // Shading follows the chosen series (and the theme, via the scale's colours).
  useEffect(() => {
    const map = mapRef.current
    if (map?.getLayer(FILL)) map.setPaintProperty(FILL, 'fill-color', fillColorExpression(scale))
  }, [scale])

  // Province shading follows the picked year (feature-state survives setData).
  const firstYear = useRef(year)
  useEffect(() => {
    if (year === firstYear.current) return
    firstYear.current = year
    const source = mapRef.current?.getSource(SOURCE) as { setData?: (d: unknown) => void } | undefined
    source?.setData?.(sourceData(provinces, year))
  }, [year, provinces])

  // Dots of the selected province, which categories show, and the picked dot.
  useEffect(() => {
    const source = mapRef.current?.getSource(CELLS_SOURCE) as { setData?: (d: unknown) => void } | undefined
    source?.setData?.(cells ? cellsSourceData(cells) : EMPTY)
  }, [cells])
  useEffect(() => {
    const map = mapRef.current
    if (map?.getLayer(RINGS)) map.setFilter(RINGS, ringFilter(showOtherViirs))
  }, [showOtherViirs])
  useEffect(() => {
    const map = mapRef.current
    if (map?.getLayer(PICKED)) map.setFilter(PICKED, pickedFilter(selectedCellId))
  }, [selectedCellId])

  // Camera: the selected province, or all of Indonesia, kept clear of the floating UI.
  const { top, right, bottom, left } = insets
  const previousSelected = useRef<string | null>(null)
  const firstCamera = useRef(true)
  const cameraMove = useRef(0)
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const previous = previousSelected.current
    previousSelected.current = selectedId
    if (map.getSource(SOURCE) && previous !== selectedId) {
      if (previous) map.setFeatureState({ source: SOURCE, id: previous }, { selected: false })
      if (selectedId) map.setFeatureState({ source: SOURCE, id: selectedId }, { selected: true })
    }
    const limit = panLimit()
    if (firstCamera.current) {
      firstCamera.current = false
      map.setMaxBounds(limit)
      return
    }
    // A smaller new limit would snap the camera into it instantly, so the limit
    // is lifted while the camera animates and applied again once it settles.
    map.setMaxBounds(null)
    const duration = reducedMotion() ? 0 : 1000
    const feature = selectedId ? provinces.features.find((f) => f.properties.province_id === selectedId) : undefined
    if (feature) {
      const pad = 32
      const target = map.cameraForBounds(geometryBounds(feature.geometry), {
        padding: { top: top + pad, right: right + pad, bottom: bottom + pad, left: left + pad },
        maxZoom: 9,
      })
      if (target?.center !== undefined && target.zoom !== undefined) {
        // Animate straight to where the pan limit lets the camera end. A province
        // at Indonesia's edge (Aceh, Papua) would otherwise be centred outside the
        // limit and snap back, unanimated, when the limit is re-applied.
        const el = container.current!
        const { lng, lat } = LngLat.convert(target.center)
        const center = clampCenter(limit, [lng, lat], target.zoom, el.clientWidth, el.clientHeight)
        map.easeTo({ center, zoom: target.zoom, bearing: 0, duration })
      }
    } else {
      map.fitBounds(limit, { padding: 0, duration })
    }
    // Re-apply the limit only when THIS move has finished. An interrupted move
    // (a quick second click, the drawer closing mid-flight) stops part-way,
    // possibly outside the limit; re-applying then would snap. Only the latest
    // move may lock, and only once the map is still. Registered after starting
    // the move, so the interrupted move's own "moveend" cannot trigger it.
    const move = ++cameraMove.current
    const lock = () => {
      if (move !== cameraMove.current) return
      if (map.isMoving()) map.once('moveend', lock)
      else map.setMaxBounds(panLimit())
    }
    lock()
    // panLimit reads the latest insets through the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, provinces, top, right, bottom, left])

  return <div ref={container} className="map" role="region" aria-label={label} />
}
