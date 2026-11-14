import { createContext, useContext } from 'react'
import type { DataClient } from './client'

export const DataContext = createContext<DataClient | null>(null)

export function useDataClient(): DataClient {
  const client = useContext(DataContext)
  if (!client) throw new Error('useDataClient must be used inside <DataProvider>')
  return client
}
