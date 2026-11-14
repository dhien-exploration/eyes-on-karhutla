import type { Manifest, ProvincesCollection } from '../data'
import { useI18n } from '../i18n/context'
import type { ProvinceHover } from '../map/IndonesiaMap'
import { provinceTotals, type Year } from '../map/years'
import { SeriesFigures } from './SeriesFigures'

type Province = ProvincesCollection['features'][number]['properties']

interface Props {
  hover: ProvinceHover
  province: Province
  series: Manifest['series']
  year: Year
}

/** Follows the pointer over the map: province name and headline numbers. */
export function HoverCard({ hover, province, series, year }: Props) {
  const { t } = useI18n()
  return (
    <div
      className={`hover-card${hover.nearRightEdge ? ' hover-card--left' : ''}`}
      style={{ left: hover.x, top: hover.y }}
      role="status"
      aria-live="polite"
    >
      <strong>{province.name}</strong>
      <span className="hover-card__metric">
        {t('metric.label')} · {year ?? t('year.all')}
      </span>
      <SeriesFigures totals={provinceTotals(province, year)} series={series} size="small" />
      <span className="hover-card__hint">{t('hover.select')}</span>
    </div>
  )
}
