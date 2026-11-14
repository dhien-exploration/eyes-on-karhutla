import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { CellDetail } from './components/CellDetail'
import { ChoroplethSection } from './components/ChoroplethSection'
import { DataErrorState } from './components/DataErrorState'
import { DotsSection } from './components/DotsSection'
import { Drawer } from './components/Drawer'
import { HoverCard } from './components/HoverCard'
import { LanguageSwitch } from './components/LanguageSwitch'
import { MenuButton } from './components/MenuButton'
import { MiniLegend } from './components/MiniLegend'
import { MonthlySection } from './components/MonthlySection'
import { NotesSection } from './components/NotesSection'
import { ProvinceSection } from './components/ProvinceSection'
import { SourcesLine } from './components/SourcesLine'
import { SourcesSection } from './components/SourcesSection'
import { YearPicker } from './components/YearPicker'
import { useCells, useManifest, useMonthly, useProvinces } from './data'
import { useMediaQuery } from './hooks/useMediaQuery'
import { useI18n } from './i18n/context'
import { parseAttribution, shortDataCredits, type Credit } from './map/attribution'
import { useColorScheme } from './map/basemap'
import { indexCellRecords } from './map/cells'
import { COLOR_BY, buildScale, type ColorBy } from './map/choropleth'
import type { Insets } from './map/geometry'
import { IndonesiaMap, type ProvinceHover } from './map/IndonesiaMap'
import { defaultYear, scaleValues, type Year } from './map/years'

// Series colours live in CSS tokens; the fallbacks match them (and AGENTS.md section 7).
const SERIES_HUE: Record<ColorBy, [token: string, fallback: string]> = {
  modis: ['--c-modis', '#2a78d6'],
  viirs_snpp: ['--c-viirs', '#eb6834'],
}

function cssVar([name, fallback]: [string, string]): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

const NARROW = '(max-width: 800px)'
const GAP = 12
/** Drawer width on wide screens (mirrored in src/styles/index.css). */
const DRAWER_W = 344
/** Height kept free at the bottom for the mini legend and the sources line. */
const BOTTOM_UI = 84
const DRAWER_KEY = 'eok.drawer'

/**
 * Bottom edge (px) of the header, measured once its size settles, so the map
 * can keep Indonesia below it. Falls back to `fallback` where ResizeObserver is
 * unavailable (tests).
 */
function useSettledBottom(ref: RefObject<HTMLElement | null>, fallback: number): number {
  const [bottom, setBottom] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let timer: ReturnType<typeof setTimeout> | undefined
    const observer = new ResizeObserver(() => {
      clearTimeout(timer)
      timer = setTimeout(() => setBottom(Math.ceil(el.getBoundingClientRect().bottom)), 150)
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
      clearTimeout(timer)
    }
  }, [ref])
  return bottom
}

// Screen space taken by the floating UI; the map keeps all of Indonesia clear
// of it. On narrow screens the open drawer is temporary, so it does not count.
function overlayInsets(narrow: boolean, drawerOpen: boolean, headerBottom: number): Insets {
  return {
    top: headerBottom + GAP,
    right: drawerOpen && !narrow ? DRAWER_W + 2 * GAP : 0,
    bottom: BOTTOM_UI,
    left: 0,
  }
}

/** Desktop: open on the first visit, then as the visitor left it. Narrow: closed. */
function initialDrawerOpen(): boolean {
  if (window.matchMedia(NARROW).matches) return false
  try {
    return window.localStorage.getItem(DRAWER_KEY) !== 'closed'
  } catch {
    return true
  }
}

export default function App() {
  const { t } = useI18n()
  const manifest = useManifest()
  const provinces = useProvinces()
  const narrow = useMediaQuery(NARROW)
  const scheme = useColorScheme()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hover, setHover] = useState<ProvinceHover | null>(null)
  // The first series in the manifest order colours the map by default; neither is favoured.
  const [colorBy, setColorBy] = useState<ColorBy>(COLOR_BY[0])
  const [drawerOpen, setDrawerOpenState] = useState(initialDrawerOpen)
  const [basemapCredits, setBasemapCredits] = useState<Credit[]>([])
  const [selectedCellId, setSelectedCellId] = useState<string | null>(null)
  // Cells seen only by other VIIRS satellites are hidden unless the visitor opts in (lode/map/cells.md).
  const [showOtherViirs, setShowOtherViirs] = useState(false)
  // The picked WIB year (null = all years). Until the visitor picks one, the
  // latest complete year from the manifest (lode/plans/multi-year.md).
  const [pickedYear, setPickedYear] = useState<Year | undefined>(undefined)
  const year: Year = pickedYear !== undefined ? pickedYear : manifest.status === 'ready' ? defaultYear(manifest.data) : null
  const cells = useCells(selectedId, year)
  // Indonesia's monthly series with no province selected, else the province's.
  const monthly = useMonthly(selectedId)
  const cellRecords = useMemo(() => (cells.status === 'ready' ? indexCellRecords(cells.data) : null), [cells])
  const selectedCell = (selectedCellId && cellRecords?.get(selectedCellId)) || null
  const header = useRef<HTMLElement>(null)
  const menuButton = useRef<HTMLButtonElement>(null)
  const headerBottom = useSettledBottom(header, 56)

  const setDrawerOpen = (open: boolean) => {
    setDrawerOpenState(open)
    if (narrow) return
    try {
      window.localStorage.setItem(DRAWER_KEY, open ? 'open' : 'closed')
    } catch {
      // Storage can be unavailable; the choice still applies for this visit.
    }
  }

  // Esc closes the drawer and returns focus to the menu button.
  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setDrawerOpenState(false)
      menuButton.current?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  const byId = useMemo(
    () =>
      new Map(
        provinces.status === 'ready' ? provinces.data.features.map((f) => [f.properties.province_id, f.properties]) : [],
      ),
    [provinces],
  )

  const scale = useMemo(
    () =>
      buildScale(colorBy, scaleValues([...byId.values()], colorBy, year), cssVar(SERIES_HUE[colorBy]), scheme),
    [byId, colorBy, scheme, year],
  )

  // Selecting a province (on the map or in the picker) opens the drawer on it.
  const select = (id: string | null) => {
    setSelectedId(id)
    setSelectedCellId(null)
    if (id) setDrawerOpen(true)
  }

  // Another year means other cell files: the picked dot no longer applies.
  const pickYear = (next: Year) => {
    setPickedYear(next)
    setSelectedCellId(null)
  }

  // Clicking a dot opens its detail at the top of the drawer.
  const selectCell = (cellId: string | null) => {
    setSelectedCellId(cellId)
    if (!cellId) return
    setDrawerOpen(true)
    requestAnimationFrame(() => document.querySelector('.drawer__scroll')?.scrollTo({ top: 0 }))
  }

  // Scrolls only the drawer's own content to the sources section. (scrollIntoView
  // would also scroll the page to reach the still off-screen drawer, making the
  // whole view lurch sideways while it slides in.) If the drawer was closed it
  // jumps there before sliding in; if it was open it scrolls smoothly.
  const showSources = () => {
    const wasOpen = drawerOpen
    setDrawerOpen(true)
    requestAnimationFrame(() => {
      const scroller = document.querySelector<HTMLElement>('.drawer__scroll')
      const target = document.getElementById('sources')
      if (!scroller || !target) return
      const smooth = wasOpen && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
      scroller.scrollTo({ top: target.offsetTop - scroller.offsetTop, behavior: smooth ? 'smooth' : 'auto' })
    })
  }

  const insets = useMemo(() => overlayInsets(narrow, drawerOpen, headerBottom), [narrow, drawerOpen, headerBottom])
  const failed = manifest.status === 'error' ? manifest : provinces.status === 'error' ? provinces : null
  const ready = !failed && manifest.status === 'ready' && provinces.status === 'ready'
  const hovered = hover && byId.get(hover.provinceId)

  return (
    <div className="app">
      <header className="app-header" ref={header}>
        <div className="brand">
          <h1>{t('app.title')}</h1>
          <p className="tagline">{t('app.tagline')}</p>
        </div>
        <div className="app-header__actions">
          <LanguageSwitch />
          {ready && manifest.status === 'ready' && <YearPicker manifest={manifest.data} year={year} onChange={pickYear} />}
          {ready && <MenuButton ref={menuButton} open={drawerOpen} onToggle={() => setDrawerOpen(!drawerOpen)} />}
        </div>
      </header>

      {failed ? (
        <main className="app-state">
          <DataErrorState error={failed.error} onRetry={failed.retry} />
        </main>
      ) : manifest.status === 'ready' && provinces.status === 'ready' ? (
        <main className="app-main" data-drawer={drawerOpen && !narrow ? 'open' : 'closed'}>
          <IndonesiaMap
            provinces={provinces.data}
            selectedId={selectedId}
            scale={scale}
            year={year}
            insets={insets}
            onSelect={select}
            onHover={setHover}
            onBasemapCredits={(html) => setBasemapCredits(html.map(parseAttribution))}
            cells={cells.status === 'ready' ? cells.data : null}
            showOtherViirs={showOtherViirs}
            selectedCellId={selectedCellId}
            onCellSelect={selectCell}
            label={t('map.label')}
            resetLabel={t('map.reset')}
            onReset={() => select(null)}
          />
          {hover && hovered && <HoverCard hover={hover} province={hovered} series={manifest.data.series} year={year} />}
          <MiniLegend scale={scale} series={manifest.data.series} dots={!!selectedId && year !== null} onOpen={() => setDrawerOpen(true)} />
          <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)}>
            {selectedCell && (
              <CellDetail
                record={selectedCell}
                manifest={manifest.data}
                showOtherViirs={showOtherViirs}
                onClose={() => setSelectedCellId(null)}
              />
            )}
            <ProvinceSection
              manifest={manifest.data}
              provinces={[...byId.values()]}
              selected={(selectedId && byId.get(selectedId)) || null}
              year={year}
              onSelect={select}
            />
            <MonthlySection
              manifest={manifest.data}
              monthly={monthly}
              place={(selectedId && byId.get(selectedId)?.name) || null}
              year={year}
              onPickYear={pickYear}
            />
            {selectedId && (
              <DotsSection
                manifest={manifest.data}
                cells={year === null ? null : cells}
                showOtherViirs={showOtherViirs}
                onShowOtherViirs={setShowOtherViirs}
              />
            )}
            <ChoroplethSection scale={scale} series={manifest.data.series} onChange={setColorBy} />
            <NotesSection manifest={manifest.data} />
            <SourcesSection manifest={manifest.data} basemap={basemapCredits} />
          </Drawer>
        </main>
      ) : (
        <main className="app-state" aria-busy="true">
          <p className="status">{t('status.loading')}</p>
        </main>
      )}

      {/* The page footer (a landmark only outside <main>): one line of credits. */}
      {ready && manifest.status === 'ready' && (
        <SourcesLine credits={[...shortDataCredits(manifest.data), ...basemapCredits]} onMore={showSources} />
      )}
    </div>
  )
}
