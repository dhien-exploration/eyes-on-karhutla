import type { Manifest } from '../data'
import { useI18n } from '../i18n/context'

/** Drawer section: what the metric is (and is not), the data period and the boundaries. */
export function NotesSection({ manifest }: { manifest: Manifest }) {
  const { t, formatDate } = useI18n()
  const { coverage, boundaries } = manifest
  return (
    <section className="drawer__section notes" aria-labelledby="notes-title">
      <h2 id="notes-title" className="drawer__heading">
        {t('notes.title')}
      </h2>
      <p>{t('metric.definition')}</p>
      <p>{t('metric.not')}</p>
      <p>{t('metric.notSummed')}</p>
      <p>
        <strong>{t('panel.coverage')}:</strong> {formatDate(coverage.first_date)} – {formatDate(coverage.last_date)} (WIB).{' '}
        {coverage.periods.length > 1 && `${t('panel.gaps')} `}
        {coverage.partial_dates.length > 0 &&
          t('panel.partialDays', { dates: coverage.partial_dates.map(formatDate).join(', ') })}
      </p>
      <p>
        {t('panel.boundaries', {
          n: boundaries.n_provinces,
          year: boundaries.year_represented,
          source: boundaries.source,
          license: boundaries.license,
        })}
      </p>
    </section>
  )
}
