import { createDataClient, DataError, indexCells } from '../../../src/data'
import * as fx from './fixtures'

type Route = unknown | (() => Response | Promise<Response>)

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
}

// A fake fetch serving files under /data/v1/; unknown paths answer 404.
function fakeFetch(routes: Record<string, Route>) {
  const calls: string[] = []
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    const route = routes[url.replace('/data/v1/', '')]
    if (route === undefined) return new Response('not found', { status: 404 })
    return typeof route === 'function' ? route() : jsonResponse(route)
  }) as unknown as typeof globalThis.fetch
  return { fetch, calls }
}

const allFiles = () => ({
  'manifest.json': fx.manifest(),
  'provinces.geojson': fx.provinces(),
  'provinces/ID-RI/daily.json': fx.daily(),
  'provinces/ID-RI/monthly.json': fx.monthly(),
  'monthly.json': fx.monthly(null),
  'provinces/ID-RI/cells/2020.geojson': fx.cells(2020),
})

async function rejection(promise: Promise<unknown>): Promise<DataError> {
  const err = await promise.then(
    () => {
      throw new Error('expected a rejection')
    },
    (e: unknown) => e,
  )
  if (!(err instanceof DataError)) throw err
  return err
}

describe('createDataClient', () => {
  it('loads every product from the default base URL', async () => {
    const { fetch, calls } = fakeFetch(allFiles())
    const data = createDataClient({ fetch })

    expect((await data.manifest()).schema_version).toBe('1.0.0')
    expect((await data.provinces()).features[0].properties.province_id).toBe('ID-RI')
    expect((await data.daily('ID-RI')).dates).toHaveLength(3)
    expect((await data.cells('ID-RI', '2020')).year).toBe(2020)
    expect((await data.monthly('ID-RI')).scope).toBe('province')
    expect((await data.monthly(null)).scope).toBe('indonesia')
    expect(calls).toEqual([
      '/data/v1/manifest.json',
      '/data/v1/provinces.geojson',
      '/data/v1/provinces/ID-RI/daily.json',
      '/data/v1/provinces/ID-RI/cells/2020.geojson',
      '/data/v1/provinces/ID-RI/monthly.json',
      '/data/v1/monthly.json',
    ])
  })

  it('takes province file paths from the manifest', async () => {
    const files = allFiles()
    files['manifest.json'].provinces[0].daily = 'elsewhere/riau-daily.json'
    const { fetch, calls } = fakeFetch({ ...files, 'elsewhere/riau-daily.json': fx.daily() })

    await createDataClient({ fetch }).daily('ID-RI')
    expect(calls).toContain('/data/v1/elsewhere/riau-daily.json')
  })

  it('requests each file once, even for concurrent calls', async () => {
    const { fetch, calls } = fakeFetch(allFiles())
    const data = createDataClient({ fetch })

    await Promise.all([data.daily('ID-RI'), data.daily('ID-RI'), data.cells('ID-RI', '2020')])
    expect(calls.filter((u) => u.endsWith('manifest.json'))).toHaveLength(1)
    expect(calls.filter((u) => u.endsWith('daily.json'))).toHaveLength(1)
  })

  it('retries a file after a failed load', async () => {
    let fail = true
    const { fetch } = fakeFetch({
      ...allFiles(),
      'manifest.json': () => (fail ? new Response('', { status: 503 }) : jsonResponse(fx.manifest())),
    })
    const data = createDataClient({ fetch })

    expect((await rejection(data.manifest())).kind).toBe('network')
    fail = false
    expect((await data.manifest()).schema_version).toBe('1.0.0')
  })

  it('honours a custom base URL', async () => {
    const { fetch, calls } = fakeFetch({})
    await rejection(createDataClient({ fetch, baseUrl: 'https://data.example/v1/' }).manifest())
    expect(calls).toEqual(['https://data.example/v1/manifest.json'])
  })
})

describe('error states', () => {
  it('network: fetch itself fails', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('offline')
    }) as unknown as typeof globalThis.fetch
    const err = await rejection(createDataClient({ fetch }).manifest())
    expect(err.kind).toBe('network')
    expect(err.file).toBe('manifest.json')
  })

  it('missing: 404', async () => {
    const { fetch } = fakeFetch({ 'manifest.json': fx.manifest() })
    const err = await rejection(createDataClient({ fetch }).cells('ID-RI', '2020'))
    expect(err.kind).toBe('missing')
    expect(err.file).toBe('provinces/ID-RI/cells/2020.geojson')
  })

  it('missing: the dev server answers with index.html', async () => {
    const { fetch } = fakeFetch({
      'manifest.json': () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }),
    })
    expect((await rejection(createDataClient({ fetch }).manifest())).kind).toBe('missing')
  })

  it('parse: invalid JSON', async () => {
    const { fetch } = fakeFetch({
      'manifest.json': () => new Response('{"schema_version":', { headers: { 'content-type': 'application/json' } }),
    })
    expect((await rejection(createDataClient({ fetch }).manifest())).kind).toBe('parse')
  })

  it('schema: a document that breaks its schema', async () => {
    const { fetch } = fakeFetch({ ...allFiles(), 'provinces.geojson': { type: 'FeatureCollection' } })
    const err = await rejection(createDataClient({ fetch }).provinces())
    expect(err.kind).toBe('schema')
    expect(err.file).toBe('provinces.geojson')
  })

  it('contract: a province the manifest does not list', async () => {
    const { fetch } = fakeFetch(allFiles())
    const err = await rejection(createDataClient({ fetch }).daily('ID-KT'))
    expect(err.kind).toBe('contract')
    expect(err.message).toContain('ID-KT')
  })
})

describe('year files', () => {
  it('takes the path for the requested year from the manifest', async () => {
    const { fetch, calls } = fakeFetch({ ...allFiles(), 'provinces/ID-RI/cells/2019.geojson': fx.cells(2019) })
    expect((await createDataClient({ fetch }).cells('ID-RI', '2019')).year).toBe(2019)
    expect(calls).toContain('/data/v1/provinces/ID-RI/cells/2019.geojson')
  })

  it('contract: a year the manifest does not list', async () => {
    const { fetch } = fakeFetch(allFiles())
    const err = await rejection(createDataClient({ fetch }).cells('ID-RI', '2015'))
    expect(err.kind).toBe('contract')
    expect(err.message).toContain('has no 2015 cells for ID-RI')
  })
})

describe('indexCells', () => {
  it('maps cell_id to the cell properties with real arrays', () => {
    const byId = indexCells(fx.cells() as Parameters<typeof indexCells>[0])
    expect(byId.get('55_10155')?.dates).toEqual(['2020-08-01', '2020-08-02'])
  })
})
