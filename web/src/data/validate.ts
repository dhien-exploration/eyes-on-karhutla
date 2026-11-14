import type { ErrorObject } from 'ajv'
import { DataError } from './errors'
import type { CellsCollection, Manifest, MonthlySeries, ProvinceDaily, ProvincesCollection } from './generated/types'
import {
  validateCellsCollection,
  validateManifest,
  validateMonthlySeries,
  validateProvinceDaily,
  validateProvincesCollection,
} from './generated/validators'

type Validator = ((data: unknown) => boolean) & { errors?: ErrorObject[] | null }

function checkSchema<T>(validate: Validator, json: unknown, file: string): T {
  if (validate(json)) return json as T
  const detail = (validate.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? 'is invalid'}`).join('; ')
  throw new DataError('schema', file, `does not match its schema (${detail})`)
}

// The schemas cannot say "these arrays have the same length"; the exporter guarantees it.
function checkParallel(arrays: Record<string, readonly unknown[]>, file: string, where: string): void {
  const [[firstKey, first], ...rest] = Object.entries(arrays)
  for (const [key, arr] of rest) {
    if (arr.length !== first.length) {
      throw new DataError(
        'contract',
        file,
        `${where}: ${key} has ${arr.length} entries but ${firstKey} has ${first.length}`,
      )
    }
  }
}

export function parseManifest(json: unknown, file = 'manifest.json'): Manifest {
  return checkSchema<Manifest>(validateManifest, json, file)
}

/**
 * With the manifest: the same provinces in both files, and per-year totals and
 * active cells for every covered year (the map and drawer read them per year).
 */
export function parseProvinces(json: unknown, file: string, manifest?: Manifest): ProvincesCollection {
  const provinces = checkSchema<ProvincesCollection>(validateProvincesCollection, json, file)
  if (!manifest) return provinces
  const listed = manifest.provinces.map((p) => p.province_id).sort().join(',')
  const drawn = provinces.features.map((f) => f.properties.province_id).sort().join(',')
  if (listed !== drawn) throw new DataError('contract', file, 'lists different provinces than manifest.json')
  for (const { properties: p } of provinces.features) {
    for (const year of Object.keys(manifest.coverage.years)) {
      if (!p.totals_by_year[year] || p.n_active_cells_by_year[year] === undefined) {
        throw new DataError('contract', file, `${p.province_id} has no ${year} totals`)
      }
    }
  }
  return provinces
}

export function parseDaily(json: unknown, file: string, provinceId: string): ProvinceDaily {
  const daily = checkSchema<ProvinceDaily>(validateProvinceDaily, json, file)
  if (daily.province_id !== provinceId) {
    throw new DataError('contract', file, `is for ${daily.province_id}, expected ${provinceId}`)
  }
  const { dates, status, modis, viirs_snpp, viirs_all } = daily
  checkParallel({ dates, status, modis, viirs_snpp, viirs_all }, file, 'daily series')
  return daily
}

/** `provinceId` null = the Indonesia series (scope "indonesia"). */
export function parseMonthly(json: unknown, file: string, provinceId: string | null): MonthlySeries {
  const monthly = checkSchema<MonthlySeries>(validateMonthlySeries, json, file)
  const expectedScope = provinceId === null ? 'indonesia' : 'province'
  if (monthly.scope !== expectedScope || monthly.province_id !== provinceId) {
    throw new DataError('contract', file, `is ${monthly.scope} ${monthly.province_id ?? ''}, expected ${expectedScope} ${provinceId ?? ''}`.trim())
  }
  const { months, status, modis, viirs_snpp, viirs_all } = monthly
  checkParallel({ months, status, modis, viirs_snpp, viirs_all }, file, 'monthly series')
  return monthly
}

export function parseCells(json: unknown, file: string, provinceId: string, year: string): CellsCollection {
  const cells = checkSchema<CellsCollection>(validateCellsCollection, json, file)
  if (cells.province_id !== provinceId || String(cells.year) !== year) {
    throw new DataError('contract', file, `is ${cells.province_id} ${cells.year}, expected ${provinceId} ${year}`)
  }
  for (const { properties: p } of cells.features) {
    const { dates, complete, modis, viirs_snpp, viirs_all, low_conf_only } = p
    checkParallel({ dates, complete, modis, viirs_snpp, viirs_all, low_conf_only }, file, `cell ${p.cell_id}`)
  }
  return cells
}
