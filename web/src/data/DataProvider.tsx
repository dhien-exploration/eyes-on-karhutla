import { useState, type ReactNode } from 'react'
import { createDataClient, type DataClient } from './client'
import { DataContext } from './context'

/** Gives components one shared DataClient (and so one shared request cache). */
export function DataProvider({ client, children }: { client?: DataClient; children: ReactNode }) {
  const [value] = useState(() => client ?? createDataClient())
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}
