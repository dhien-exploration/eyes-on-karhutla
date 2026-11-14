import { DataError, type Manifest, type ResourceState, type CellsCollection } from '../data'
import { useI18n } from '../i18n/context'
import { countCategory, otherViirsPlatforms, type CellCategory } from '../map/cells'

interface Props {
  manifest: Manifest
  /** Null when no year is picked: dots exist per year only. */
  cells: ResourceState<CellsCollection> | null
  showOtherViirs: boolean
  onShowOtherViirs: (show: boolean) => void
}

const FILLED: CellCategory[] = ['both', 'modis', 'viirs_snpp']

/** Drawer section for the selected province's dots: key, notes, the other-VIIRS switch, load state. */
export function DotsSection({ manifest, cells, showOtherViirs, onShowOtherViirs }: Props) {
  const { t, formatNumber } = useI18n()
  const platforms = otherViirsPlatforms(manifest)

  return (
    <section className="drawer__section dots" aria-labelledby="dots-title" aria-busy={cells?.status === 'loading'}>
      <h2 id="dots-title" className="drawer__heading">
        {t('dots.title')}
      </h2>
      {!cells && <p className="dots__status">{t('dots.pickYear')}</p>}
      {cells?.status === 'loading' && <p className="dots__status">{t('dots.loading')}</p>}
      {cells?.status === 'error' && (
        <div className="dots__error" role="alert">
          <p>
            {t(cells.error instanceof DataError ? `error.title.${cells.error.kind}` : 'error.title.unknown')}
            {cells.error instanceof DataError && <code> {cells.error.file}</code>}
          </p>
          <button type="button" onClick={cells.retry}>
            {t('error.retry')}
          </button>
        </div>
      )}
      <ul className="dots__key">
        {FILLED.map((cat) => (
          <li key={cat}>
            <span className={`dot dot--${cat}`} aria-hidden="true" />
            {t(`dots.cat.${cat}`)}
          </li>
        ))}
        <li>
          <span className="dot dot--partial" aria-hidden="true" />
          {t('dots.cat.partial')}
        </li>
        {showOtherViirs && (
          <li>
            <span className="dot dot--other_viirs" aria-hidden="true" />
            {t('dots.cat.other_viirs', { platforms })}
          </li>
        )}
        <li>
          <span className="dot dot--both dot--low" aria-hidden="true" />
          {t('dots.low')}
        </li>
      </ul>
      <p className="dots__note">{t('dots.bothNote')}</p>

      <label className="dots__switch">
        <input type="checkbox" checked={showOtherViirs} onChange={(e) => onShowOtherViirs(e.target.checked)} />
        <span>{t('dots.showOther', { platforms })}</span>
      </label>
      {showOtherViirs ? (
        <p className="dots__warning">
          {t('dots.otherWarning')} <q lang="en">{manifest.series_notes.viirs_all}</q>
        </p>
      ) : (
        cells?.status === 'ready' && (
          <p className="dots__note">{t('dots.hidden', { n: formatNumber(countCategory(cells.data, 'other_viirs')) })}</p>
        )
      )}
      {cells?.status === 'ready' && <p className="dots__hint">{t('dots.hint')}</p>}
    </section>
  )
}
