import { useCallback, useEffect, useState } from 'react'
import type { DataClient } from './client'
import { useDataClient } from './context'
import type { CellsCollection, Manifest, MonthlySeries, ProvinceDaily, ProvincesCollection } from './generated/types'

export type Resource<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; error: Error }

export type ResourceState<T> = Resource<T> & { retry: () => void }

/**
 * Loads one data product for a component. `key` identifies the request: when it
 * changes, the previous result is dropped and the new one loads. A `null` key
 * loads nothing (stays 'loading'). `retry` re-runs a failed load.
 */
export function useResource<T>(key: string | null, load: (client: DataClient) => Promise<T>): ResourceState<T> {
  const client = useDataClient()
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{ key: string; attempt: number; resource: Resource<T> } | null>(null)

  useEffect(() => {
    if (key === null) return
    let current = true
    load(client).then(
      (data) => current && setResult({ key, attempt, resource: { status: 'ready', data } }),
      (error: unknown) =>
        current &&
        setResult({
          key,
          attempt,
          resource: { status: 'error', error: error instanceof Error ? error : new Error(String(error)) },
        }),
    )
    return () => {
      current = false
    }
    // `load` is expected to be an inline function; `key` stands for its inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, key, attempt])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  const resource: Resource<T> =
    result && result.key === key && result.attempt === attempt ? result.resource : { status: 'loading' }
  return { ...resource, retry }
}

export const useManifest = (): ResourceState<Manifest> => useResource('manifest', (c) => c.manifest())

export const useProvinces = (): ResourceState<ProvincesCollection> => useResource('provinces', (c) => c.provinces())

export const useDaily = (provinceId: string | null): ResourceState<ProvinceDaily> =>
  useResource(provinceId && `daily:${provinceId}`, (c) => c.daily(provinceId!))

/** Monthly series of a province, or of Indonesia when `provinceId` is null. */
export const useMonthly = (provinceId: string | null): ResourceState<MonthlySeries> =>
  useResource(`monthly:${provinceId ?? 'indonesia'}`, (c) => c.monthly(provinceId))

/** Cells of one province for one WIB year; nothing loads until both are chosen. */
export const useCells = (provinceId: string | null, year: string | null): ResourceState<CellsCollection> =>
  useResource(provinceId && year ? `cells:${provinceId}:${year}` : null, (c) => c.cells(provinceId!, year!))
