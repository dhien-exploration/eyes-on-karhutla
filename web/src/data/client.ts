import { DataError } from './errors'
import type { CellsCollection, Manifest, MonthlySeries, ProvinceDaily, ProvincesCollection } from './generated/types'
import { parseCells, parseDaily, parseManifest, parseMonthly, parseProvinces } from './validate'

export type CellProperties = CellsCollection['features'][number]['properties']

export interface DataClient {
  manifest(): Promise<Manifest>
  provinces(): Promise<ProvincesCollection>
  /** Lazy-loads one province's daily series; the path comes from the manifest. */
  daily(provinceId: string): Promise<ProvinceDaily>
  /** Monthly series: one province, or Indonesia when `provinceId` is null. */
  monthly(provinceId: string | null): Promise<MonthlySeries>
  /** Lazy-loads one province's active cells for one WIB year (e.g. "2019"); the path comes from the manifest. */
  cells(provinceId: string, year: string): Promise<CellsCollection>
}

export interface DataClientOptions {
  /** URL of the data root, ending in "/". Defaults to `${BASE_URL}data/v1/`. */
  baseUrl?: string
  fetch?: typeof globalThis.fetch
}

export function createDataClient({
  baseUrl = `${import.meta.env.BASE_URL}data/v1/`,
  fetch = globalThis.fetch.bind(globalThis),
}: DataClientOptions = {}): DataClient {
  // One request per file. A failed request is forgotten so the next call retries it.
  const cache = new Map<string, Promise<unknown>>()

  function load<T>(file: string, parse: (json: unknown) => T): Promise<T> {
    let pending = cache.get(file) as Promise<T> | undefined
    if (!pending) {
      pending = fetchJson(fetch, baseUrl, file).then(parse)
      pending.catch(() => cache.delete(file))
      cache.set(file, pending)
    }
    return pending
  }

  const manifest = () => load('manifest.json', (json) => parseManifest(json))

  async function provinceEntry(provinceId: string) {
    const entry = (await manifest()).provinces.find((p) => p.province_id === provinceId)
    if (!entry) throw new DataError('contract', 'manifest.json', `has no province ${provinceId}`)
    return entry
  }

  return {
    manifest,
    provinces: async () => {
      const m = await manifest()
      const file = m.files.provinces
      return load(file, (json) => parseProvinces(json, file, m))
    },
    daily: async (provinceId) => {
      const file = (await provinceEntry(provinceId)).daily
      return load(file, (json) => parseDaily(json, file, provinceId))
    },
    monthly: async (provinceId) => {
      const file = provinceId === null ? (await manifest()).files.monthly : (await provinceEntry(provinceId)).monthly
      return load(file, (json) => parseMonthly(json, file, provinceId))
    },
    cells: async (provinceId, year) => {
      const file = (await provinceEntry(provinceId)).cells[year]
      if (!file) throw new DataError('contract', 'manifest.json', `has no ${year} cells for ${provinceId}`)
      return load(file, (json) => parseCells(json, file, provinceId, year))
    },
  }
}

async function fetchJson(fetch: typeof globalThis.fetch, baseUrl: string, file: string): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(baseUrl + file)
  } catch (cause) {
    throw new DataError('network', file, 'request failed', { cause })
  }
  if (res.status === 404) throw new DataError('missing', file, 'not found')
  if (!res.ok) throw new DataError('network', file, `server answered ${res.status}`)
  // Vite's dev server (and many static hosts) answer unknown paths with index.html.
  if (res.headers.get('content-type')?.includes('text/html')) {
    throw new DataError('missing', file, 'not found (got an HTML page)')
  }
  try {
    return await res.json()
  } catch (cause) {
    throw new DataError('parse', file, 'is not valid JSON', { cause })
  }
}

/**
 * Cells by cell_id. MapLibre stringifies array properties on queried features,
 * so dot details must be read from here, not from the clicked map feature.
 */
export function indexCells(cells: CellsCollection): Map<string, CellProperties> {
  return new Map(cells.features.map((f) => [f.properties.cell_id, f.properties]))
}
