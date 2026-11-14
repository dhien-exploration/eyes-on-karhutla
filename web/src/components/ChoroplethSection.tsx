import type { Manifest } from '../data'
import { useI18n } from '../i18n/context'
import { COLOR_BY, legendRows, type ChoroplethScale, type ColorBy } from '../map/choropleth'

interface Props {
  scale: ChoroplethScale
  series: Manifest['series']
  onChange: (colorBy: ColorBy) => void
}

/** Drawer section: which series colours the provinces, and its full legend. */
export function ChoroplethSection({ scale, series, onChange }: Props) {
  const { t, formatNumber } = useI18n()
  const range = (from: number, to: number) =>
    from === to ? formatNumber(from) : `${formatNumber(from)}–${formatNumber(to)}`

  return (
    <section className="drawer__section choropleth" aria-labelledby="choropleth-title">
      <h2 id="choropleth-title" className="drawer__heading">
        {t('choropleth.title')}
      </h2>
      <div className="segmented" role="group" aria-label={t('choropleth.title')}>
        {COLOR_BY.map((key) => (
          <button
            key={key}
            type="button"
            className={`segmented__btn segmented__btn--${key}`}
            aria-pressed={scale.colorBy === key}
            onClick={() => onChange(key)}
          >
            {series[key].label}
          </button>
        ))}
      </div>
      <p className="choropleth__legend-title">{t('choropleth.legend', { series: series[scale.colorBy].label })}</p>
      <ul className="choropleth__legend">
        {legendRows(scale).map((row) => (
          <li key={row.from}>
            <span className="choropleth__swatch" style={{ background: row.color }} aria-hidden="true" />
            {range(row.from, row.to)}
          </li>
        ))}
      </ul>
      <p className="choropleth__note">{t('choropleth.note')}</p>
    </section>
  )
}
