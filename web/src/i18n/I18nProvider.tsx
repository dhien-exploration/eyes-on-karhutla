import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { DEFAULT_LANG, STRINGS, isLang, type Lang, type StringKey } from './strings'
import { I18nContext, type Vars } from './context'

const STORAGE_KEY = 'eok.lang'
const LOCALES: Record<Lang, string> = { id: 'id-ID', en: 'en-GB' }

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match))
}

function readStoredLang(): Lang {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return isLang(stored) ? stored : DEFAULT_LANG
  } catch {
    return DEFAULT_LANG
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readStoredLang)

  const setLang = useCallback((next: Lang) => {
    setLangState(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Storage can be unavailable (private mode); the choice still applies for this visit.
    }
  }, [])

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const value = useMemo(() => {
    const locale = LOCALES[lang]
    const numbers = new Intl.NumberFormat(locale)
    const dates = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    return {
      lang,
      setLang,
      t: (key: StringKey, vars?: Vars) => interpolate(STRINGS[lang][key], vars),
      formatNumber: (n: number) => numbers.format(n),
      formatDate: (isoDate: string) => dates.format(new Date(`${isoDate}T00:00:00Z`)),
    }
  }, [lang, setLang])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}
