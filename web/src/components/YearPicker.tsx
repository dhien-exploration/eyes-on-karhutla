import type { Manifest } from '../data'
import { useI18n } from '../i18n/context'
import { coveredYears, type Year } from '../map/years'

interface Props {
  manifest: Manifest
  year: Year
  onChange: (year: Year) => void
}

/**
 * "Semua tahun" + every covered WIB year; partial years are marked.
 * A native <select> is as wide as its longest option, so the pill shows the
 * current label as text (it sizes to that) and the real select lies over the
 * whole pill, invisible but focusable and clickable, with the native list.
 */
export function YearPicker({ manifest, year, onChange }: Props) {
  const { t } = useI18n()
  const label = (y: string) => (manifest.coverage.years[y] === 'complete' ? y : t('year.partial', { year: y }))
  return (
    <label className="year-picker">
      <span className="year-picker__label">{t('year.label')}</span>
      <span className="year-picker__value" aria-hidden="true">
        {year === null ? t('year.all') : label(year)}
      </span>
      {/* Lucide "chevron-down" (ISC License, Copyright (c) 2026 Lucide Icons and Contributors). */}
      <svg className="year-picker__chevron" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m6 9 6 6 6-6" />
      </svg>
      <select value={year ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{t('year.all')}</option>
        {coveredYears(manifest)
          .slice()
          .reverse()
          .map((y) => (
            <option key={y} value={y}>
              {label(y)}
            </option>
          ))}
      </select>
    </label>
  )
}
