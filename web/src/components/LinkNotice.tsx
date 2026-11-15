import { useI18n } from '../i18n/context'
import type { ViewParam } from '../share/view'

/** Says which parts of an opened link were not recognised (lode/ui/share-links.md). */
export function LinkNotice({ rejected, onDismiss }: { rejected: ViewParam[]; onDismiss: () => void }) {
  const { t } = useI18n()
  const params = rejected.map((p) => t(`link.param.${p}`)).join(', ')
  return (
    <div className="link-notice" role="status">
      <p>{t('link.notice', { params })}</p>
      <button type="button" onClick={onDismiss} aria-label={t('link.dismiss')}>
        ×
      </button>
    </div>
  )
}
