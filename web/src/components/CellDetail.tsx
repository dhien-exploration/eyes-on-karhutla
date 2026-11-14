import type { Manifest } from '../data'
import { useI18n } from '../i18n/context'
import { cellCategory, otherViirsPlatforms, type CellRecord } from '../map/cells'
import { SeriesFigures } from './SeriesFigures'

interface Props {
  record: CellRecord
  manifest: Manifest
  showOtherViirs: boolean
  onClose: () => void
}

/** Drawer section for one dot: where it is, its agreement category, and every detection date per sensor. */
export function CellDetail({ record, manifest, showOtherViirs, onClose }: Props) {
  const { t, formatDate, lang } = useI18n()
  const p = record.properties
  const [lon, lat] = record.centre
  const coord = (v: number) => v.toLocaleString(lang === 'id' ? 'id-ID' : 'en-GB', { maximumFractionDigits: 3 })
  const cat = cellCategory(p)
  const mark = (on: boolean) => (
    <span className={on ? 'tick' : 'tick tick--off'} aria-label={t(on ? 'cell.detected' : 'cell.notDetected')}>
      {on ? '✓' : '·'}
    </span>
  )

  return (
    <section className="drawer__section cell" aria-labelledby="cell-title">
      <div className="cell__head">
        <h2 id="cell-title" className="drawer__heading">
          {t('cell.title')}
        </h2>
        <button type="button" className="cell__close" onClick={onClose}>
          {t('cell.close')}
        </button>
      </div>
      <p className="cell__where">{t('cell.location', { lat: coord(lat), lon: coord(lon) })}</p>
      <p className="cell__cat">
        <span className={`dot dot--${cat}`} aria-hidden="true" />
        {t(`dots.cat.${cat}`, { platforms: otherViirsPlatforms(manifest) })}
      </p>
      <p className="cell__metric">{t('cell.activeDays')}</p>
      <SeriesFigures totals={{ modis: p.modis_days, viirs_snpp: p.viirs_snpp_days }} series={manifest.series} size="small" />
      <table className="cell__table">
        <thead>
          <tr>
            <th scope="col">{t('cell.date')}</th>
            <th scope="col">MODIS</th>
            <th scope="col">VIIRS S-NPP</th>
            {showOtherViirs && <th scope="col">{t('cell.other')}</th>}
            <th scope="col">{t('cell.notes')}</th>
          </tr>
        </thead>
        <tbody>
          {p.dates.map((date, i) => {
            // viirs_all includes S-NPP; "other" means seen by viirs_all without S-NPP on that date.
            const other = p.viirs_all[i] && !p.viirs_snpp[i]
            return (
              <tr key={date} className={p.complete[i] ? undefined : 'is-partial'}>
                <th scope="row">{formatDate(date)}</th>
                <td>{mark(p.modis[i])}</td>
                <td>{mark(p.viirs_snpp[i])}</td>
                {showOtherViirs && <td>{mark(other)}</td>}
                <td>
                  {!p.complete[i] && <span className="tag">{t('cell.partial')}</span>}
                  {p.low_conf_only[i] && <span className="tag">{t('cell.lowConf')}</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}
