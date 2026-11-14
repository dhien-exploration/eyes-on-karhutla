// Data access for the exported data products (public/data/v1/). Components
// use this module only; they never fetch files directly.
export { createDataClient, indexCells } from './client'
export type { CellProperties, DataClient, DataClientOptions } from './client'
export { DataError } from './errors'
export type { DataErrorKind } from './errors'
export { DataProvider } from './DataProvider'
export { useDataClient } from './context'
export { useCells, useDaily, useManifest, useMonthly, useProvinces, useResource } from './hooks'
export type { Resource, ResourceState } from './hooks'
export type { CellsCollection, Manifest, MonthlySeries, ProvinceDaily, ProvincesCollection } from './generated/types'
