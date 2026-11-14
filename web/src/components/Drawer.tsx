import type { ReactNode } from 'react'
import { useI18n } from '../i18n/context'

interface Props {
  open: boolean
  onClose: () => void
  children: ReactNode
}

/**
 * Non-modal side drawer: the map stays interactive behind it. It slides both
 * ways; when closed it is inert and hidden from assistive tech.
 */
export function Drawer({ open, onClose, children }: Props) {
  const { t } = useI18n()
  return (
    <aside id="drawer" className="drawer" data-open={open} aria-label={t('menu.label')} aria-hidden={!open} inert={!open}>
      <div className="drawer__top">
        <span className="drawer__title">{t('menu.label')}</span>
        <button type="button" className="drawer__close" onClick={onClose} aria-label={t('menu.close')} title={t('menu.close')}>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="drawer__scroll">{children}</div>
    </aside>
  )
}
