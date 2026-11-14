import type { Manifest } from '../data'
import { useI18n } from '../i18n/context'

// The two default series, always side by side and never summed (AGENTS.md sections 2 and 7).
const SERIES = ['modis', 'viirs_snpp'] as const

interface Props {
  totals: Record<(typeof SERIES)[number], number>
  series: Manifest['series']
  size?: 'large' | 'small'
}

export function SeriesFigures({ totals, series, size = 'large' }: Props) {
  const { formatNumber } = useI18n()
  return (
    <dl className={`series-figures series-figures--${size}`}>
      {SERIES.map((key) => (
        <div key={key} className={`series-figure series-figure--${key}`}>
          <dt>
            <span className="swatch" aria-hidden="true" />
            {series[key].label}
          </dt>
          <dd>{formatNumber(totals[key])}</dd>
        </div>
      ))}
    </dl>
  )
}
