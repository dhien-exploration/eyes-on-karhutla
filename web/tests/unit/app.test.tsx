import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import App from '../../src/App'
import { DataError, DataProvider, type DataClient } from '../../src/data'
import { I18nProvider } from '../../src/i18n/I18nProvider'
import * as fx from './data/fixtures'

// jsdom has no WebGL: replace the map with a stub that exposes its props.
vi.mock('../../src/map/IndonesiaMap', () => ({
  IndonesiaMap: (props: {
    selectedId: string | null
    onSelect: (id: string) => void
    onCellSelect: (id: string | null) => void
    cells: { features: unknown[] } | null
    showOtherViirs: boolean
    label: string
  }) => (
    <div
      role="region"
      aria-label={props.label}
      data-selected={props.selectedId ?? ''}
      data-dots={props.cells ? props.cells.features.length : 'none'}
      data-other={String(props.showOtherViirs)}
    >
      <button type="button" onClick={() => props.onSelect('ID-RI')}>
        stub-map-click-riau
      </button>
      <button type="button" onClick={() => props.onCellSelect('55_10155')}>
        stub-dot-click
      </button>
    </div>
  ),
}))

// uPlot needs a real canvas: replace the chart with a stub that exposes its props.
vi.mock('../../src/components/MonthlyChart', () => ({
  MonthlyChart: (props: { monthly: { months: string[] }; year: string | null; onPickYear: (y: string) => void }) => (
    <div data-testid="chart" data-year={props.year ?? ''} data-months={props.monthly.months.length}>
      <button type="button" onClick={() => props.onPickYear('2019')}>
        stub-chart-click-2019
      </button>
    </div>
  ),
}))

function fakeClient(overrides: Partial<DataClient> = {}): DataClient {
  return {
    manifest: async () => fx.manifest() as never,
    provinces: async () => fx.provinces() as never,
    daily: async () => fx.daily() as never,
    monthly: async (id) => fx.monthly(id) as never,
    cells: async (id, year) => fx.cells(Number(year), id) as never,
    ...overrides,
  }
}

function renderApp(client: DataClient) {
  return render(
    <I18nProvider>
      <DataProvider client={client}>
        <App />
      </DataProvider>
    </I18nProvider>,
  )
}

describe('App', () => {
  beforeEach(() => window.localStorage.clear())

  it('shows a loading state, then the map and national totals side by side', async () => {
    renderApp(fakeClient())
    expect(screen.getByText('Memuat data…')).toBeInTheDocument()

    expect(await screen.findByRole('heading', { name: 'Seluruh Indonesia' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /Peta provinsi Indonesia/ })).toBeInTheDocument()
    const panel = within(screen.getByRole('region', { name: 'Seluruh Indonesia' }))
    // Opens on the latest complete year (2020): Indonesia = sum of provinces, outside shown apart.
    expect(panel.getByText('Active cell-days · 2020')).toBeInTheDocument()
    expect(panel.getByText('MODIS (Terra + Aqua)').closest('div')).toHaveTextContent('3')
    expect(panel.getByText('VIIRS S-NPP').closest('div')).toHaveTextContent('6')
    expect(panel.getByText(/Di luar provinsi/)).toHaveTextContent('MODIS 0 · VIIRS S-NPP 1')
    // viirs_all is off by default and never shown as a headline number.
    expect(screen.queryByText('VIIRS all satellites')).not.toBeInTheDocument()
  })

  it('selects a province from the map and goes back to Indonesia', async () => {
    renderApp(fakeClient())
    fireEvent.click(await screen.findByText('stub-map-click-riau'))

    expect(screen.getByRole('heading', { name: 'Riau' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /Peta/ })).toHaveAttribute('data-selected', 'ID-RI')
    expect(screen.getByRole('combobox', { name: 'Pilih provinsi' })).toHaveValue('ID-RI')

    fireEvent.click(screen.getByRole('button', { name: 'Kembali ke seluruh Indonesia' }))
    expect(screen.getByRole('heading', { name: 'Seluruh Indonesia' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /Peta/ })).toHaveAttribute('data-selected', '')
  })

  it('colours the map by one sensor at a time, MODIS first', async () => {
    renderApp(fakeClient())
    const modis = await screen.findByRole('button', { name: 'MODIS (Terra + Aqua)' })
    const viirs = screen.getByRole('button', { name: 'VIIRS S-NPP' })
    expect(modis).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Active cell-days per provinsi, MODIS (Terra + Aqua)')).toBeInTheDocument()

    fireEvent.click(viirs)
    expect(viirs).toHaveAttribute('aria-pressed', 'true')
    expect(modis).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('Active cell-days per provinsi, VIIRS S-NPP')).toBeInTheDocument()
    expect(screen.getByText(/Jangan bandingkan warna antar sensor/)).toBeInTheDocument()
  })

  it('opens and closes the drawer from the menu button, with Esc, and from the mini legend', async () => {
    renderApp(fakeClient())
    const menu = await screen.findByRole('button', { name: 'Tutup menu' , expanded: true })
    const drawer = screen.getByRole('complementary', { name: 'Menu' })
    expect(drawer).toHaveAttribute('data-open', 'true')

    fireEvent.click(menu)
    expect(drawer).toHaveAttribute('data-open', 'false')
    // Kept mounted so it can slide out, but inert and hidden from assistive tech.
    expect(drawer).toHaveAttribute('aria-hidden', 'true')
    expect(drawer).toHaveAttribute('inert')
    expect(screen.queryByRole('combobox', { name: 'Pilih provinsi' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Buka legenda dan pilihan sensor' }))
    expect(drawer).toHaveAttribute('data-open', 'true')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(drawer).toHaveAttribute('data-open', 'false')
    expect(screen.getByRole('button', { name: 'Buka menu' })).toHaveFocus()
  })

  it('remembers a closed drawer on the next visit', async () => {
    const { unmount } = renderApp(fakeClient())
    fireEvent.click(await screen.findByRole('button', { name: 'Tutup menu', expanded: true }))
    unmount()
    renderApp(fakeClient())
    expect(await screen.findByRole('button', { name: 'Buka menu' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('keeps the colour key on the map while the drawer is closed', async () => {
    renderApp(fakeClient())
    fireEvent.click(await screen.findByRole('button', { name: 'Tutup menu', expanded: true }))
    const mini = screen.getByRole('button', { name: 'Buka legenda dan pilihan sensor' })
    expect(mini).toHaveTextContent('MODIS (Terra + Aqua)')
    expect(mini).toHaveTextContent('0 – 3')
  })

  it('shows a one-line sources bar that opens the full credits', async () => {
    renderApp(fakeClient())
    const line = await screen.findByRole('contentinfo')
    expect(line).toHaveTextContent('NASA FIRMS')
    expect(line).toHaveTextContent('geoBoundaries')
    fireEvent.click(screen.getByRole('button', { name: 'Tutup menu', expanded: true }))
    fireEvent.click(within(line).getByRole('button', { name: 'Sumber' }))
    expect(screen.getByRole('complementary', { name: 'Menu' })).toHaveAttribute('data-open', 'true')
    expect(screen.getByRole('heading', { name: 'Sumber data' })).toBeInTheDocument()
  })

  it('opens the drawer when a province is selected on the map', async () => {
    renderApp(fakeClient())
    fireEvent.click(await screen.findByRole('button', { name: 'Tutup menu', expanded: true }))
    fireEvent.click(screen.getByText('stub-map-click-riau'))
    expect(screen.getByRole('complementary', { name: 'Menu' })).toHaveAttribute('data-open', 'true')
    expect(screen.getByRole('combobox', { name: 'Pilih provinsi' })).toHaveValue('ID-RI')
  })

  it('shows dots for the selected province only, with their key and the hidden count', async () => {
    renderApp(fakeClient())
    const map = await screen.findByRole('region', { name: /Peta/ })
    expect(map).toHaveAttribute('data-dots', 'none')

    fireEvent.click(screen.getByText('stub-map-click-riau'))
    await waitFor(() => expect(map).toHaveAttribute('data-dots', '1'))
    const dots = within(screen.getByRole('region', { name: 'Titik panas (sel 0,01°)' }))
    expect(dots.getByText('Kedua sensor')).toBeInTheDocument()
    expect(dots.getByText('Hanya tanggal parsial')).toBeInTheDocument()
    expect(dots.getByText(/0 sel hanya terdeteksi satelit VIIRS lain/)).toBeInTheDocument()
    // The mini legend switches to the dot key.
    expect(screen.getByRole('button', { name: 'Buka legenda dan pilihan sensor' })).toHaveTextContent('Kedua sensor')

    fireEvent.click(screen.getByRole('button', { name: 'Kembali ke seluruh Indonesia' }))
    expect(map).toHaveAttribute('data-dots', 'none')
  })

  it('shows a loading state, then an error with retry, for a province whose cells fail', async () => {
    let fail = true
    renderApp(
      fakeClient({
        cells: async () => {
          if (fail) throw new DataError('missing', 'provinces/ID-RI/cells/2020.geojson', 'not found')
          return fx.cells() as never
        },
      }),
    )
    fireEvent.click(await screen.findByText('stub-map-click-riau'))
    expect(screen.getByText('Memuat titik…')).toBeInTheDocument()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('provinces/ID-RI/cells/2020.geojson')
    fail = false
    fireEvent.click(within(alert).getByRole('button', { name: 'Coba lagi' }))
    await waitFor(() => expect(screen.getByRole('region', { name: /Peta/ })).toHaveAttribute('data-dots', '1'))
  })

  it('opens a dot detail with every date per sensor, read from the loaded data', async () => {
    renderApp(fakeClient())
    fireEvent.click(await screen.findByText('stub-map-click-riau'))
    await waitFor(() => expect(screen.getByRole('region', { name: /Peta/ })).toHaveAttribute('data-dots', '1'))
    fireEvent.click(screen.getByText('stub-dot-click'))

    const detail = within(screen.getByRole('region', { name: 'Detail titik' }))
    expect(detail.getByText('Sel 0,01° di 0,555, 101,555')).toBeInTheDocument()
    const rows = detail.getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)
    // 1 Aug 2020: partial date, VIIRS S-NPP only. 2 Aug: both sensors.
    expect(rows[0]).toHaveTextContent('1 Agu 2020')
    expect(within(rows[0]).getByText('parsial')).toBeInTheDocument()
    expect(within(rows[0]).getAllByLabelText('terdeteksi')).toHaveLength(1)
    expect(within(rows[1]).getAllByLabelText('terdeteksi')).toHaveLength(2)

    fireEvent.click(detail.getByRole('button', { name: 'Tutup detail' }))
    expect(screen.queryByRole('region', { name: 'Detail titik' })).not.toBeInTheDocument()
  })

  it('shows other VIIRS satellites only on request, with the manifest warning', async () => {
    renderApp(fakeClient())
    fireEvent.click(await screen.findByText('stub-map-click-riau'))
    const toggle = await screen.findByRole('checkbox', { name: 'Tampilkan juga satelit VIIRS lain (NOAA-20, NOAA-21)' })
    expect(toggle).not.toBeChecked()
    fireEvent.click(toggle)
    expect(screen.getByRole('region', { name: /Peta/ })).toHaveAttribute('data-other', 'true')
    expect(screen.getByText(/bukan berarti lebih banyak kebakaran/)).toHaveTextContent('the series jumps when they start')
  })

  it('clears the dot detail when another province is selected', async () => {
    renderApp(fakeClient())
    fireEvent.click(await screen.findByText('stub-map-click-riau'))
    await waitFor(() => expect(screen.getByRole('region', { name: /Peta/ })).toHaveAttribute('data-dots', '1'))
    fireEvent.click(screen.getByText('stub-dot-click'))
    expect(screen.getByRole('region', { name: 'Detail titik' })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: 'Pilih provinsi' }), { target: { value: '' } })
    expect(screen.queryByRole('region', { name: 'Detail titik' })).not.toBeInTheDocument()
  })

  it('picks a year: figures follow it, partial years are marked, and dots need a year', async () => {
    renderApp(fakeClient())
    const year = await screen.findByRole('combobox', { name: 'Tahun' })
    expect(year).toHaveValue('2020')
    expect(within(year).getByRole('option', { name: '2019 (parsial)' })).toBeInTheDocument()

    fireEvent.change(year, { target: { value: '2019' } })
    const panel = within(screen.getByRole('region', { name: 'Seluruh Indonesia' }))
    expect(panel.getByText('MODIS (Terra + Aqua)').closest('div')).toHaveTextContent('2')
    expect(panel.getByText('Tahun parsial: tidak semua tanggal tercakup.')).toBeInTheDocument()

    fireEvent.click(screen.getByText('stub-map-click-riau'))
    const map = screen.getByRole('region', { name: /Peta/ })
    await waitFor(() => expect(map).toHaveAttribute('data-dots', '1'))

    // All years: exported all-years totals, and no dots (they exist per year only).
    fireEvent.change(year, { target: { value: '' } })
    expect(screen.getByText('Active cell-days · Semua tahun')).toBeInTheDocument()
    expect(map).toHaveAttribute('data-dots', 'none')
    expect(screen.getByText('Pilih satu tahun untuk melihat titik panas per sel.')).toBeInTheDocument()
  })

  it('shows the monthly chart for Indonesia, then for the selected province', async () => {
    const calls: (string | null)[] = []
    renderApp(
      fakeClient({
        monthly: async (id) => {
          calls.push(id)
          return fx.monthly(id) as never
        },
      }),
    )
    expect(await screen.findByRole('region', { name: 'Aktivitas bulanan · Seluruh Indonesia' })).toBeInTheDocument()
    expect(screen.getByTestId('chart')).toHaveAttribute('data-year', '2020')
    fireEvent.click(screen.getByText('stub-map-click-riau'))
    expect(await screen.findByRole('region', { name: 'Aktivitas bulanan · Riau' })).toBeInTheDocument()
    expect(calls).toEqual([null, 'ID-RI'])
  })

  it('picks the year of a clicked month', async () => {
    renderApp(fakeClient())
    fireEvent.click(await screen.findByText('stub-chart-click-2019'))
    expect(screen.getByRole('combobox', { name: 'Tahun' })).toHaveValue('2019')
    expect(screen.getByTestId('chart')).toHaveAttribute('data-year', '2019')
  })

  it('offers the monthly values as a table, with missing months as — and statuses named', async () => {
    renderApp(fakeClient())
    const section = within(await screen.findByRole('region', { name: /Aktivitas bulanan/ }))
    const rows = section.getAllByRole('row').slice(1)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('Jan 2019')
    expect(rows[0]).toHaveTextContent('parsial')
    expect(rows[2]).toHaveTextContent('Mar 2019')
    expect(rows[2]).toHaveTextContent('——tidak ada data')
    expect(section.getByText(/Deteksi bukan kebakaran/)).toBeInTheDocument()
  })

  it('selects a province with the keyboard-friendly picker', async () => {
    renderApp(fakeClient())
    fireEvent.change(await screen.findByRole('combobox', { name: 'Pilih provinsi' }), { target: { value: 'ID-RI' } })
    expect(screen.getByRole('heading', { name: 'Riau' })).toBeInTheDocument()
  })

  it('shows an error state instead of the map, and retries', async () => {
    let fail = true
    const client = fakeClient({
      provinces: async () => {
        if (fail) throw new DataError('schema', 'provinces.geojson', 'does not match its schema')
        return fx.provinces() as never
      },
    })
    renderApp(client)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Berkas data tidak sesuai format')
    expect(alert).toHaveTextContent('provinces.geojson')
    expect(screen.queryByRole('region', { name: /Peta/ })).not.toBeInTheDocument()

    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Seluruh Indonesia' })).toBeInTheDocument())
  })
})
