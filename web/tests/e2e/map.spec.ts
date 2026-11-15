// Critical map flows (AGENTS.md section 12.7). Runs against the Vite dev server,
// which exposes the MapLibre instance as window.__eokMap, and the real export in
// public/data/v1/ (skipped when it is absent). The OpenFreeMap basemap is
// replaced by a blank style so the tests do not depend on the network.
import { expect, test, type Page } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dataRoot = fileURLToPath(new URL('../../public/data/v1', import.meta.url))
test.skip(!existsSync(join(dataRoot, 'manifest.json')), 'no exported data in public/data/v1')

// A blank basemap with one (empty) label layer, so layer order can be checked.
const BLANK_STYLE = {
  version: 8,
  sources: { labels: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#e8e8e4' } },
    { id: 'place-labels', type: 'symbol', source: 'labels', layout: { 'text-field': '' } },
  ],
}
const KALIMANTAN_TENGAH: [number, number] = [113.4, -1.6]

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(join(dataRoot, file), 'utf8')) as T
}

/** The year the app opens on: the latest complete year of the export. */
function defaultYear(): string {
  const { coverage } = readJson<{ coverage: { years: Record<string, string> } }>('manifest.json')
  return Object.keys(coverage.years).filter((y) => coverage.years[y] === 'complete').sort().at(-1)!
}

async function openMap(page: Page) {
  await page.route('https://tiles.openfreemap.org/**', (route) => route.fulfill({ json: BLANK_STYLE }))
  await page.goto('/')
  await waitForIdle(page)
}

async function waitForIdle(page: Page) {
  await page.waitForFunction(() => {
    const map = (window as unknown as { __eokMap?: import('maplibre-gl').Map }).__eokMap
    return map?.loaded() && !map.isMoving() && map.getLayer('provinces-fill') !== undefined
  })
}

async function screenPoint(page: Page, lngLat: [number, number]) {
  return page.evaluate((lngLat) => {
    const map = (window as unknown as { __eokMap: import('maplibre-gl').Map }).__eokMap
    const p = map.project(lngLat)
    const r = map.getCanvas().getBoundingClientRect()
    return { x: r.left + p.x, y: r.top + p.y }
  }, lngLat)
}

const mapState = (page: Page) =>
  page.evaluate(() => {
    const map = (window as unknown as { __eokMap: import('maplibre-gl').Map }).__eokMap
    return { zoom: map.getZoom(), center: map.getCenter().toArray() }
  })

const nf = new Intl.NumberFormat('id-ID')

test('shows all of Indonesia with national totals, MODIS and VIIRS S-NPP side by side', async ({ page }) => {
  const manifest = readJson<{
    coverage: { years: Record<string, string> }
    totals: { indonesia_by_year: Record<string, Record<string, number>> }
  }>('manifest.json')
  // The app opens on the latest complete year.
  const year = Object.keys(manifest.coverage.years).filter((y) => manifest.coverage.years[y] === 'complete').sort().at(-1)!
  const national = manifest.totals.indonesia_by_year[year]
  await openMap(page)

  await expect(page.getByRole('heading', { name: 'Seluruh Indonesia', exact: true })).toBeVisible()
  const panel = page.getByRole('region', { name: 'Seluruh Indonesia', exact: true })
  await expect(panel).toContainText(nf.format(national.modis))
  await expect(panel).toContainText(nf.format(national.viirs_snpp))
  await expect(page.getByRole('contentinfo')).toContainText('NASA FIRMS')
})

test('hovering a province shows its name and headline numbers', async ({ page }) => {
  await openMap(page)
  const p = await screenPoint(page, KALIMANTAN_TENGAH)
  await page.mouse.move(p.x, p.y)

  const card = page.locator('.hover-card')
  await expect(card).toContainText('Central Kalimantan')
  await expect(card).toContainText('MODIS')
  await expect(card).toContainText('VIIRS S-NPP')

  await page.mouse.move(5, 5)
  await expect(card).toBeHidden()
})

test('clicking a province selects it and flies in; going back returns to Indonesia', async ({ page }) => {
  await openMap(page)
  const before = await mapState(page)

  const p = await screenPoint(page, KALIMANTAN_TENGAH)
  await page.mouse.click(p.x, p.y)
  await expect(page.getByRole('heading', { name: 'Central Kalimantan', exact: true })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Pilih provinsi' })).toHaveValue('ID-KT')
  await waitForIdle(page)
  expect((await mapState(page)).zoom).toBeGreaterThan(before.zoom + 1.5)

  await page.getByRole('button', { name: 'Kembali ke seluruh Indonesia' }).click()
  await waitForIdle(page)
  expect((await mapState(page)).zoom).toBeCloseTo(before.zoom, 0)
  await expect(page.getByRole('heading', { name: 'Seluruh Indonesia', exact: true })).toBeVisible()
})

test('the picker selects a province without the mouse', async ({ page }) => {
  await openMap(page)
  await page.getByRole('combobox', { name: 'Pilih provinsi' }).selectOption('ID-RI')
  await expect(page.getByRole('heading', { name: 'Riau', exact: true })).toBeVisible()
})

test('the map stays on Indonesia: no panning or zooming out beyond it', async ({ page }) => {
  await openMap(page)
  const start = await mapState(page)
  await page.evaluate(() => {
    const map = (window as unknown as { __eokMap: import('maplibre-gl').Map }).__eokMap
    map.jumpTo({ center: [0, 50], zoom: 1 })
  })
  const after = await mapState(page)
  // At the widest view nothing can move: the limit is sized to the viewport.
  expect(after.zoom).toBeCloseTo(start.zoom, 2)
  expect(after.center[0]).toBeCloseTo(start.center[0], 2)
  expect(after.center[1]).toBeCloseTo(start.center[1], 2)

  const bounds = await page.evaluate(() => {
    const map = (window as unknown as { __eokMap: import('maplibre-gl').Map }).__eokMap
    return map.getBounds().toArray()
  })
  // Indonesia is fully in view.
  expect(bounds[0][0]).toBeLessThanOrEqual(94.7 + 1e-3)
  expect(bounds[1][0]).toBeGreaterThanOrEqual(141.1 - 1e-3)
})

test('basemap labels are drawn on top of the province colours', async ({ page }) => {
  await openMap(page)
  const order = await page.evaluate(() => {
    const map = (window as unknown as { __eokMap: import('maplibre-gl').Map }).__eokMap
    return map.getStyle().layers.map((l) => l.id)
  })
  expect(order.indexOf('outside-mask')).toBeLessThan(order.indexOf('provinces-fill'))
  expect(order.indexOf('provinces-line')).toBeLessThan(order.indexOf('place-labels'))
})

test('closing the drawer gives Indonesia more room, animated both ways', async ({ page }) => {
  await openMap(page)
  const before = (await mapState(page)).zoom
  await page.locator('.menu-button').click()
  // Mid-animation the zoom is between the two end states (no instant jump).
  await page.waitForTimeout(300)
  const midway = (await mapState(page)).zoom
  await waitForIdle(page)
  const after = (await mapState(page)).zoom
  expect(after).toBeGreaterThan(before)
  expect(midway).toBeGreaterThan(before)
  expect(midway).toBeLessThan(after)
  await expect(page.getByRole('combobox', { name: 'Pilih provinsi' })).toBeHidden()

  await page.locator('.menu-button').click()
  await page.waitForTimeout(300)
  const back = (await mapState(page)).zoom
  expect(back).toBeLessThan(after)
  expect(back).toBeGreaterThan(before)
  await waitForIdle(page)
  expect((await mapState(page)).zoom).toBeCloseTo(before, 1)
})

test('top right reads: language switch, year, menu; the drawer holds every section', async ({ page }) => {
  await openMap(page)
  const lang = (await page.locator('.lang-switch').boundingBox())!
  const year = (await page.locator('.year-picker').boundingBox())!
  const menu = (await page.locator('.menu-button').boundingBox())!
  expect(year.x).toBeGreaterThan(lang.x + lang.width)
  expect(menu.x).toBeGreaterThan(year.x + year.width)
  expect(year.height).toBeCloseTo(lang.height, 0)

  const drawer = page.getByRole('complementary', { name: 'Menu' })
  for (const heading of ['Seluruh Indonesia', 'Aktivitas bulanan · Seluruh Indonesia', 'Warnai peta menurut', 'Bagikan tampilan ini', 'Tentang data', 'Sumber data']) {
    await expect(drawer.getByRole('heading', { name: heading, exact: true })).toBeVisible()
  }

  await page.keyboard.press('Escape')
  await expect(drawer).toBeHidden()
  // The colour key stays on the map.
  await expect(page.locator('.mini-legend')).toContainText('MODIS (Terra + Aqua)')
})

test('the menu button is a circle the height of the language switch', async ({ page }) => {
  await openMap(page)
  const lang = (await page.locator('.lang-switch').boundingBox())!
  const menu = (await page.locator('.menu-button').boundingBox())!
  expect(menu.width).toBeCloseTo(menu.height, 0)
  expect(menu.height).toBeCloseTo(lang.height, 0)
  expect(await page.locator('.menu-button').evaluate((b) => getComputedStyle(b).borderRadius)).toBe('999px')
})

test('the mini legend stays centred while the drawer opens and closes', async ({ page }) => {
  await openMap(page)
  const centre = async () => {
    const b = (await page.locator('.mini-legend').boundingBox())!
    return b.x + b.width / 2
  }
  const width = page.viewportSize()!.width
  expect(await centre()).toBeCloseTo(width / 2, 0)
  await page.locator('.menu-button').click()
  await page.waitForTimeout(400)
  expect(await centre()).toBeCloseTo(width / 2, 0)
})

test('opening the sources from the footer never scrolls the page', async ({ page }) => {
  await openMap(page)
  await page.locator('.menu-button').click()
  await page.waitForTimeout(500)
  await page.getByRole('contentinfo').getByRole('button', { name: 'Sumber' }).click()
  const scrolls: number[] = []
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(50)
    scrolls.push(
      await page.evaluate(() =>
        Math.max(...['html', 'body', '.app', '.app-main', '.drawer'].map((s) => Math.abs(document.querySelector(s)!.scrollLeft))),
      ),
    )
  }
  expect(Math.max(...scrolls)).toBe(0)
  await expect(page.getByRole('heading', { name: 'Sumber data' })).toBeInViewport()
})

test('one tiny line of sources sits on the bottom edge', async ({ page }) => {
  await openMap(page)
  const line = page.getByRole('contentinfo')
  await expect(line).toContainText('NASA FIRMS')
  await expect(line).toContainText('geoBoundaries (ODbL)')
  const box = await line.boundingBox()
  const viewport = page.viewportSize()!
  expect(box!.y + box!.height).toBeCloseTo(viewport.height, 0)
  expect(box!.height).toBeLessThan(24) // a single line
  await expect(page.locator('.maplibregl-ctrl-attrib')).toHaveCount(0)

  await line.getByRole('button', { name: 'Sumber' }).click()
  await expect(page.getByRole('heading', { name: 'Sumber data' })).toBeInViewport()
})

test('the year picker drives the map: dots per year, none for all years', async ({ page }) => {
  await openMap(page)
  const year = page.getByRole('combobox', { name: 'Tahun' })
  await expect(year).toHaveValue(defaultYear())
  await page.getByRole('combobox', { name: 'Pilih provinsi' }).selectOption('ID-RI')
  await expect.poll(() => cellsInSource(page), { timeout: 15_000 }).toBeGreaterThan(0)
  const inDefault = await cellsInSource(page)

  await year.selectOption('2019')
  await expect.poll(() => cellsInSource(page), { timeout: 15_000 }).not.toBe(inDefault)
  await year.selectOption('')
  await expect.poll(() => cellsInSource(page)).toBe(0)
  await expect(page.getByText('Pilih satu tahun untuk melihat titik panas per sel.')).toBeVisible()
})

test('the province shading switches between sensors and never mixes them', async ({ page }) => {
  await openMap(page)
  const fillColor = () =>
    page.evaluate(() => {
      const map = (window as unknown as { __eokMap: import('maplibre-gl').Map }).__eokMap
      return JSON.stringify(map.getPaintProperty('provinces-fill', 'fill-color'))
    })

  expect(await fillColor()).toContain('total_modis')
  await expect(page.locator('.choropleth')).toContainText('MODIS (Terra + Aqua)')

  await page.getByRole('button', { name: 'VIIRS S-NPP' }).click()
  await expect.poll(fillColor).toContain('total_viirs_snpp')
  expect(await fillColor()).not.toContain('total_modis')
})

test('switching to English translates the panel', async ({ page }) => {
  await openMap(page)
  await page.getByRole('button', { name: 'EN', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'All of Indonesia', exact: true })).toBeVisible()
  await expect(page.getByText('Active cell-days').first()).toBeVisible()
})

const cellsInSource = (page: Page) =>
  page.evaluate(() => (window as unknown as { __eokMap: import('maplibre-gl').Map }).__eokMap.querySourceFeatures('cells').length)

test('selecting a province draws its cells as dots, under the labels; going back removes them', async ({ page }) => {
  await openMap(page)
  expect(await cellsInSource(page)).toBe(0)
  const started = Date.now()
  await page.getByRole('combobox', { name: 'Pilih provinsi' }).selectOption('ID-KB') // the largest province: 20,591 cells
  await expect.poll(() => cellsInSource(page), { timeout: 15_000 }).toBeGreaterThan(0)
  expect(Date.now() - started).toBeLessThan(5_000)
  await expect(page.getByRole('region', { name: 'Titik panas (sel 0,01°)' })).toContainText('disembunyikan')

  const order = await page.evaluate(() =>
    (window as unknown as { __eokMap: import('maplibre-gl').Map }).__eokMap.getStyle().layers.map((l) => l.id),
  )
  expect(order.indexOf('provinces-line')).toBeLessThan(order.indexOf('cells-dot'))
  expect(order.indexOf('cells-selected')).toBeLessThan(order.indexOf('place-labels'))

  await page.getByRole('button', { name: 'Kembali ke seluruh Indonesia' }).click()
  await expect.poll(() => cellsInSource(page)).toBe(0)
})

test('clicking a dot opens its detection history in the drawer', async ({ page }) => {
  await openMap(page)
  await page.getByRole('combobox', { name: 'Pilih provinsi' }).selectOption('ID-RI')
  await expect.poll(() => cellsInSource(page), { timeout: 15_000 }).toBeGreaterThan(0)
  await waitForIdle(page)
  const dot = await page.evaluate(() => {
    const map = (window as unknown as { __eokMap: import('maplibre-gl').Map }).__eokMap
    const f = map.queryRenderedFeatures({ layers: ['cells-dot'] })[0]
    const p = map.project((f.geometry as { coordinates: [number, number] }).coordinates)
    const r = map.getCanvas().getBoundingClientRect()
    return { x: r.left + p.x, y: r.top + p.y, id: f.properties.cell_id as string }
  })
  await page.mouse.click(dot.x, dot.y)
  const detail = page.getByRole('region', { name: 'Detail titik' })
  await expect(detail).toBeVisible()
  await expect(detail.getByRole('row').nth(1)).toBeVisible()
  // The province stays selected: a dot click does not re-select the province underneath.
  await expect(page.getByRole('combobox', { name: 'Pilih provinsi' })).toHaveValue('ID-RI')
  const picked = await page.evaluate(() =>
    (window as unknown as { __eokMap: import('maplibre-gl').Map }).__eokMap.getFilter('cells-selected'),
  )
  expect(JSON.stringify(picked)).toContain(dot.id)
})

test('other VIIRS satellites appear as rings only when switched on', async ({ page }) => {
  await openMap(page)
  await page.getByRole('combobox', { name: 'Pilih provinsi' }).selectOption('ID-RI')
  await expect.poll(() => cellsInSource(page), { timeout: 15_000 }).toBeGreaterThan(0)
  const ringFilter = () =>
    page.evaluate(() =>
      JSON.stringify((window as unknown as { __eokMap: import('maplibre-gl').Map }).__eokMap.getFilter('cells-ring')),
    )
  expect(await ringFilter()).not.toContain('other_viirs')
  await page.getByRole('checkbox', { name: /Tampilkan juga satelit VIIRS lain/ }).check()
  await expect.poll(ringFilter).toContain('other_viirs')
})

test('the reset button above the zoom buttons flies back to the starting view', async ({ page }) => {
  await openMap(page)
  const start = await mapState(page)
  const reset = page.getByRole('button', { name: 'Kembali ke tampilan awal' })
  const resetBox = (await reset.boundingBox())!
  const zoomBox = (await page.locator('.maplibregl-ctrl-zoom-in').boundingBox())!
  expect(resetBox.y + resetBox.height).toBeLessThanOrEqual(zoomBox.y + 1)

  await page.evaluate(() => (window as unknown as { __eokMap: import('maplibre-gl').Map }).__eokMap.jumpTo({ center: [110, -7], zoom: 8 }))
  await reset.click()
  await waitForIdle(page)
  const after = await mapState(page)
  expect(after.zoom).toBeCloseTo(start.zoom, 1)
  expect(after.center[0]).toBeCloseTo(start.center[0], 0)

  // The name follows the language.
  await page.getByRole('button', { name: 'EN', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Back to the starting view' })).toBeVisible()
})

test('the reset button also clears the selected province', async ({ page }) => {
  await openMap(page)
  const start = await mapState(page)
  await page.getByRole('combobox', { name: 'Pilih provinsi' }).selectOption('ID-KT')
  await expect.poll(() => cellsInSource(page), { timeout: 15_000 }).toBeGreaterThan(0)
  await waitForIdle(page)

  await page.getByRole('button', { name: 'Kembali ke tampilan awal' }).click()
  await expect(page.getByRole('heading', { name: 'Seluruh Indonesia', exact: true })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Pilih provinsi' })).toHaveValue('')
  await expect.poll(() => cellsInSource(page)).toBe(0)
  await page.waitForTimeout(150)
  await waitForIdle(page)
  expect((await mapState(page)).zoom).toBeCloseTo(start.zoom, 1)
  // The year is kept.
  await expect(page.getByRole('combobox', { name: 'Tahun' })).toHaveValue(defaultYear())
})

test('edge provinces fly in and out without a snap afterwards, even when interrupted', async ({ page }) => {
  await openMap(page)
  // A snap = the camera changing right after a move ends while no new animation
  // is running (e.g. maxBounds forcing it back in). Animated moves don't count.
  await page.evaluate(() => {
    const map = (window as unknown as { __eokMap: import('maplibre-gl').Map }).__eokMap
    const log: number[] = []
    ;(window as unknown as { __snaps: number[] }).__snaps = log
    map.on('moveend', () => {
      const end = map.getCenter().toArray()
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (map.isMoving()) return
          const now = map.getCenter().toArray()
          log.push(Math.max(Math.abs(now[0] - end[0]), Math.abs(now[1] - end[1])))
        }),
      )
    })
  })
  const picker = page.getByRole('combobox', { name: 'Pilih provinsi' })
  const settle = async () => {
    await page.waitForTimeout(150)
    await waitForIdle(page)
  }
  for (const id of ['ID-AC', 'ID-SU', 'ID-PA']) {
    await picker.selectOption(id)
    await settle()
    await page.keyboard.press('Escape') // closing the drawer re-fits with more room
    await settle()
    await page.locator('.menu-button').click()
    await settle()
  }
  // Interrupted: close the drawer while Aceh is still flying in.
  await picker.selectOption('ID-RI')
  await settle()
  await picker.selectOption('ID-AC')
  await page.waitForTimeout(300)
  await page.keyboard.press('Escape')
  await settle()
  await page.waitForTimeout(100)

  const snaps = await page.evaluate(() => (window as unknown as { __snaps: number[] }).__snaps)
  expect(snaps.length).toBeGreaterThanOrEqual(3)
  expect(Math.max(...snaps)).toBeLessThan(1e-6)
})

test('the monthly chart draws both sensors, picks a year on click, and has a table', async ({ page }) => {
  const indonesia = readJson<{ months: string[]; modis: (number | null)[]; viirs_snpp: (number | null)[] }>('monthly.json')
  await openMap(page)
  const section = page.getByRole('region', { name: 'Aktivitas bulanan · Seluruh Indonesia' })
  await expect(section.locator('canvas')).toBeVisible()
  await expect(section.locator('.u-legend')).toContainText('MODIS (Terra + Aqua)')
  await expect(section.locator('.u-legend')).toContainText('VIIRS S-NPP')

  // Long ranges scroll sideways: the picked (latest complete) year is in view.
  const scroll = section.locator('.monthly-chart__scroll')
  const year = page.getByRole('combobox', { name: 'Tahun' })
  await expect(year).toHaveValue(defaultYear())
  const over = section.locator('.u-over')
  // Scrolls month i to the middle of the visible chart and returns its point.
  const monthAt = async (i: number) => {
    const n = indonesia.months.length
    await scroll.evaluate((el, f) => {
      const o = el.querySelector('.u-over') as HTMLElement
      el.scrollLeft = o.offsetLeft + f * o.offsetWidth - el.clientWidth / 2
    }, i / (n - 1))
    const box = (await over.boundingBox())!
    return { x: box.x + (i / (n - 1)) * box.width, y: box.y + box.height / 2 }
  }
  const visible = await scroll.evaluate((el) => el.scrollWidth > el.clientWidth && el.scrollLeft > 0)
  expect(visible).toBe(true)

  // Hover the busiest VIIRS month: the legend shows both exported values.
  const peak = indonesia.viirs_snpp.indexOf(Math.max(...indonesia.viirs_snpp.map((v) => v ?? 0)))
  const p = await monthAt(peak)
  await page.mouse.move(p.x, p.y, { steps: 2 })
  const nf = new Intl.NumberFormat('id-ID')
  await expect(section.locator('.u-legend')).toContainText(nf.format(indonesia.viirs_snpp[peak]!))
  await expect(section.locator('.u-legend')).toContainText(nf.format(indonesia.modis[peak]!))

  // Clicking a month picks its year.
  // Scrolling does not move uPlot's cursor: point at the month before clicking, as a user would.
  const q = await monthAt(3)
  await page.mouse.move(q.x, q.y, { steps: 2 })
  await expect(section.locator('.u-legend')).toContainText(String(Number(indonesia.months[3].slice(0, 4))))
  await page.mouse.click(q.x, q.y)
  await expect(year).toHaveValue(indonesia.months[3].slice(0, 4))

  await section.getByText('Tampilkan sebagai tabel').click()
  await expect(section.getByRole('table')).toBeVisible()
  await expect(section.getByRole('row')).toHaveCount(indonesia.months.length + 1)
})

test('selecting a province switches the chart to that province', async ({ page }) => {
  await openMap(page)
  await page.getByRole('combobox', { name: 'Pilih provinsi' }).selectOption('ID-KT')
  await expect(page.getByRole('region', { name: 'Aktivitas bulanan · Central Kalimantan' }).locator('canvas')).toBeVisible()
})

test('a shared link opens its province, year and sensor; the address follows the view', async ({ page }) => {
  await page.route('https://tiles.openfreemap.org/**', (route) => route.fulfill({ json: BLANK_STYLE }))
  await page.goto('/?province=ID-RI&year=2019&sensor=viirs_snpp')
  await waitForIdle(page)
  await expect(page.getByRole('combobox', { name: 'Pilih provinsi' })).toHaveValue('ID-RI')
  await expect(page.getByRole('combobox', { name: 'Tahun' })).toHaveValue('2019')
  await expect(page.getByRole('button', { name: 'VIIRS S-NPP', exact: true })).toHaveAttribute('aria-pressed', 'true')
  // The camera flew in: zoomed past the national view.
  expect((await mapState(page)).zoom).toBeGreaterThan(5)
  await expect.poll(() => cellsInSource(page), { timeout: 15_000 }).toBeGreaterThan(0)

  await page.getByRole('combobox', { name: 'Pilih provinsi' }).selectOption('ID-KT')
  await expect(page).toHaveURL(/\?province=ID-KT&year=2019&sensor=viirs_snpp$/)
})

test('an unrecognised link shows a notice and the default view', async ({ page }) => {
  await page.route('https://tiles.openfreemap.org/**', (route) => route.fulfill({ json: BLANK_STYLE }))
  await page.goto('/?province=ID-XX')
  await waitForIdle(page)
  await expect(page.getByRole('status')).toContainText('Sebagian tautan tidak dikenali (provinsi)')
  await expect(page.getByRole('heading', { name: 'Seluruh Indonesia', exact: true })).toBeVisible()
  await expect(page).toHaveURL(/\/$/)
})
