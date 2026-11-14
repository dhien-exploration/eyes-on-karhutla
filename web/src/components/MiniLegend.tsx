import type { Manifest } from '../data'
import { useI18n } from '../i18n/context'
import type { CellCategory } from '../map/cells'
import type { ChoroplethScale } from '../map/choropleth'

interface Props {
  scale: ChoroplethScale
  series: Manifest['series']
  /** A province is selected, so its dots carry the meaning: show the dot key instead. */
  dots: boolean
  onOpen: () => void
}

const DOT_KEY: CellCategory[] = ['both', 'modis', 'viirs_snpp', 'partial']

/**
 * Always on the map, so colours are never shown without their key: the
 * province shading (sensor, ramp, range), or the dot categories while a
 * province is open. Opens the drawer for the full legend.
 */
export function MiniLegend({ scale, series, dots, onOpen }: Props) {
  const { t, formatNumber } = useI18n()
  return (
    <button type="button" className={`mini-legend${dots ? ' mini-legend--dots' : ''}`} onClick={onOpen} aria-label={t('legend.open')}>
      {dots ? (
        DOT_KEY.map((cat) => (
          <span key={cat} className="mini-legend__item">
            <span className={`dot dot--${cat}`} aria-hidden="true" />
            {t(`dots.cat.${cat}`, { platforms: '' })}
          </span>
        ))
      ) : (
        <>
          <span className={`chip chip--${scale.colorBy}`}>{series[scale.colorBy].label}</span>
          <span className="mini-legend__ramp" aria-hidden="true">
            {[scale.zeroColor, ...scale.colors].map((color) => (
              <span key={color} style={{ background: color }} />
            ))}
          </span>
          <span className="mini-legend__range">
            0 – {formatNumber(scale.max)} <span className="mini-legend__unit">{t('metric.label')}</span>
          </span>
        </>
      )}
    </button>
  )
}
