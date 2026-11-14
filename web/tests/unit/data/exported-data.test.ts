// Checks the real export in public/data/v1/ against the contract.
// Skipped when the data is not present (it is git-ignored).
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseCells, parseDaily, parseManifest, parseMonthly, parseProvinces } from '../../../src/data/validate'

const root = join(__dirname, '../../../public/data/v1')
const present = existsSync(join(root, 'manifest.json'))
const read = (file: string): unknown => JSON.parse(readFileSync(join(root, file), 'utf8'))

describe.skipIf(!present)('exported data in public/data/v1', () => {
  it('manifest, provinces, monthly and every province × year file match the contract', () => {
    const manifest = parseManifest(read('manifest.json'))
    parseProvinces(read(manifest.files.provinces), manifest.files.provinces, manifest)
    parseMonthly(read(manifest.files.monthly), manifest.files.monthly, null)

    const years = Object.keys(manifest.coverage.years)
    for (const entry of manifest.provinces) {
      parseDaily(read(entry.daily), entry.daily, entry.province_id)
      parseMonthly(read(entry.monthly), entry.monthly, entry.province_id)
      expect(Object.keys(entry.cells).sort()).toEqual(years)
      for (const [year, file] of Object.entries(entry.cells)) parseCells(read(file), file, entry.province_id, year)
    }
  }, 120_000)
})
