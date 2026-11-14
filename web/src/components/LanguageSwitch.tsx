import { useI18n } from '../i18n/context'
import { LANGUAGES } from '../i18n/strings'

// Always-visible ID/EN toggle, pinned to the top-right of the page.
export function LanguageSwitch() {
  const { lang, setLang, t } = useI18n()

  return (
    <div className="lang-switch" role="group" aria-label={t('lang.label')}>
      {LANGUAGES.map((code) => (
        <button
          key={code}
          type="button"
          lang={code}
          aria-pressed={lang === code}
          title={t(`lang.${code}.name`)}
          onClick={() => setLang(code)}
        >
          {t(`lang.${code}`)}
        </button>
      ))}
    </div>
  )
}
