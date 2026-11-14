import type { Manifest, ProvincesCollection } from '../data'
import { useI18n } from '../i18n/context'
import { indonesiaTotals, outsideTotals, provinceActiveCells, provinceTotals, yearStatus, type Year } from '../map/years'
import { SeriesFigures } from './SeriesFigures'

type Province = ProvincesCollection['features'][number]['properties']

interface Props {
  manifest: Manifest
  provinces: Province[]
  selected: Province | null
  year: Year
  onSelect: (provinceId: string | null) => void
}

/** Drawer section: the selected province (or all of Indonesia), with a keyboard-friendly picker. */
export function ProvinceSection({ manifest, provinces, selected, year, onSelect }: Props) {
  const { t, formatNumber } = useI18n()
  const sorted = [...provinces].sort((a, b) => a.name.localeCompare(b.name))
  const activeCells = selected ? provinceActiveCells(selected, year) : null
  const outside = outsideTotals(manifest, year)

  return (
    <section className="drawer__section province" aria-labelledby="province-title">
      <label className="province__picker">
        <span>{t('panel.pick')}</span>
        <select value={selected?.province_id ?? ''} onChange={(e) => onSelect(e.target.value || null)}>
          <option value="">{t('panel.pickNone')}</option>
          {sorted.map((p) => (
            <option key={p.province_id} value={p.province_id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <h2 id="province-title" className="province__name">
        {selected ? selected.name : t('panel.national')}
      </h2>
      <p className="province__metric">
        {t('metric.label')} · {year ?? t('year.all')}
      </p>
      <SeriesFigures
        totals={selected ? provinceTotals(selected, year) : indonesiaTotals(manifest, year)}
        series={manifest.series}
      />
      {yearStatus(manifest, year) === 'partial' && <p className="province__hint">{t('panel.partialYear')}</p>}
      {selected && activeCells !== null && (
        <p className="province__cells">
          {t('panel.activeCells')}: {formatNumber(activeCells)}
        </p>
      )}
      {!selected && (
        <p className="province__hint">
          {t('panel.outside', { modis: formatNumber(outside.modis), viirs: formatNumber(outside.viirs_snpp) })}
        </p>
      )}
      {selected ? (
        <button type="button" className="province__clear" onClick={() => onSelect(null)}>
          {t('panel.clear')}
        </button>
      ) : (
        <p className="province__hint">{t('panel.hint')}</p>
      )}
    </section>
  )
}
