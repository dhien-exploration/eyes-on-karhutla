import { createContext, useContext } from 'react'
import type { Lang, StringKey } from './strings'

export type Vars = Record<string, string | number>

export interface I18n {
  lang: Lang
  setLang: (lang: Lang) => void
  /** Looks up a string; `{name}` placeholders are replaced from `vars`. */
  t: (key: StringKey, vars?: Vars) => string
  /** Locale-formatted integer, e.g. 63.725 (id) / 63,725 (en). */
  formatNumber: (n: number) => string
  /** Formats a "YYYY-MM-DD" calendar date without shifting it through a time zone. */
  formatDate: (isoDate: string) => string
}

export const I18nContext = createContext<I18n | null>(null)

export function useI18n(): I18n {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>')
  return ctx
}
