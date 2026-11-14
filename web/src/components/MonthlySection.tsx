import { platformMarkers } from '../chart/monthly'
import { DataError, type Manifest, type MonthlySeries, type ResourceState } from '../data'
import { useI18n } from '../i18n/context'
import { platformName } from '../map/cells'
import type { Year } from '../map/years'
import { MonthlyChart } from './MonthlyChart'

interface Props {
  manifest: Manifest
  monthly: ResourceState<MonthlySeries>
  /** Province name, or null for Indonesia. */
  place: string | null
  year: Year
  onPickYear: (year: string) => void
}

/** Drawer section: the monthly chart with its caption, caveats and a table alternative. */
export function MonthlySection({ manifest, monthly, place, year, onPickYear }: Props) {
  const { t, formatNumber, formatDate, lang } = useI18n()
  const monthName = new Intl.DateTimeFormat(lang === 'id' ? 'id-ID' : 'en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })
  const statusLabel = { complete: '', partial: t('chart.partial'), missing: t('chart.missing') }

  return (
    <section className="drawer__section monthly" aria-labelledby="monthly-title" aria-busy={monthly.status === 'loading'}>
      <h2 id="monthly-title" className="drawer__heading">
        {t('chart.title', { place: place ?? t('panel.national') })}
      </h2>
      {monthly.status === 'loading' && <p className="monthly__status">{t('status.loading')}</p>}
      {monthly.status === 'error' && (
        <div className="dots__error" role="alert">
          <p>
            {t(monthly.error instanceof DataError ? `error.title.${monthly.error.kind}` : 'error.title.unknown')}
            {monthly.error instanceof DataError && <code> {monthly.error.file}</code>}
          </p>
          <button type="button" onClick={monthly.retry}>
            {t('error.retry')}
          </button>
        </div>
      )}
      {monthly.status === 'ready' && (
        <figure className="monthly__figure">
          <MonthlyChart monthly={monthly.data} manifest={manifest} year={year} onPickYear={onPickYear} />
          <figcaption>
            <p>{t('chart.caption')}</p>
            {platformMarkers(manifest, monthly.data).map((m) => (
              <p key={`${m.platform}-${m.kind}`}>
                {t(m.kind === 'start' ? 'chart.markerStart' : 'chart.markerEnd', { platform: platformName(m.platform), date: formatDate(m.date) })}
              </p>
            ))}
            <p className="monthly__caveat">{t('chart.caveat')}</p>
          </figcaption>
          <details className="monthly__table">
            <summary>{t('chart.table')}</summary>
            <table>
              <thead>
                <tr>
                  <th scope="col">{t('chart.month')}</th>
                  <th scope="col">{manifest.series.modis.label}</th>
                  <th scope="col">{manifest.series.viirs_snpp.label}</th>
                  <th scope="col">{t('cell.notes')}</th>
                </tr>
              </thead>
              <tbody>
                {monthly.data.months.map((month, i) => {
                  const [y, m] = month.split('-').map(Number)
                  const value = (v: number | null) => (v == null ? '—' : formatNumber(v))
                  return (
                    <tr key={month} className={monthly.data.status[i] === 'complete' ? undefined : 'is-partial'}>
                      <th scope="row">{monthName.format(new Date(Date.UTC(y, m - 1, 1)))}</th>
                      <td>{value(monthly.data.modis[i])}</td>
                      <td>{value(monthly.data.viirs_snpp[i])}</td>
                      <td>{statusLabel[monthly.data.status[i]]}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </details>
        </figure>
      )}
    </section>
  )
}
