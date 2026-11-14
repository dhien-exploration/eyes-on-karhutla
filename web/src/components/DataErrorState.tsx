import { DataError } from '../data'
import { useI18n } from '../i18n/context'
import type { StringKey } from '../i18n/strings'

/** Shown instead of the map when a data product fails to load or validate. */
export function DataErrorState({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const { t } = useI18n()
  const titleKey: StringKey = error instanceof DataError ? `error.title.${error.kind}` : 'error.title.unknown'
  return (
    <div className="data-error" role="alert">
      <h2>{t(titleKey)}</h2>
      <p>{t('error.body')}</p>
      {error instanceof DataError && (
        <p className="data-error__file">
          {t('error.file')}: <code>{error.file}</code>
        </p>
      )}
      <details>
        <summary>{error.name}</summary>
        <code>{error.message}</code>
      </details>
      <button type="button" onClick={onRetry}>
        {t('error.retry')}
      </button>
    </div>
  )
}
