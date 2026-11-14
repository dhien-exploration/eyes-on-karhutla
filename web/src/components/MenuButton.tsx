import type { Ref } from 'react'
import { useI18n } from '../i18n/context'

/** The ☰ button beside the language switch; opens and closes the drawer. */
export function MenuButton({ open, onToggle, ref }: { open: boolean; onToggle: () => void; ref?: Ref<HTMLButtonElement> }) {
  const { t } = useI18n()
  const label = open ? t('menu.close') : t('menu.open')
  return (
    <button
      ref={ref}
      type="button"
      className="menu-button"
      aria-expanded={open}
      aria-controls="drawer"
      aria-label={label}
      title={label}
      onClick={onToggle}
    >
      <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
        <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </button>
  )
}
