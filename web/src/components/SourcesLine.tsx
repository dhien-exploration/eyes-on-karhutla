import { Fragment } from 'react'
import { useI18n } from '../i18n/context'
import type { Credit as CreditParts } from '../map/attribution'
import { Credit } from './Credit'

interface Props {
  credits: CreditParts[]
  onMore: () => void
}

/**
 * One small, always-visible line of credits at the bottom edge (OSMF attribution
 * guidelines: visible without interaction, readable, links to more information).
 * "Sumber" opens the full wording in the drawer.
 */
export function SourcesLine({ credits, onMore }: Props) {
  const { t } = useI18n()
  return (
    <footer className="sources-line">
      {credits.map((parts, i) => (
        <Fragment key={i}>
          {i > 0 && <span aria-hidden="true"> · </span>}
          <Credit parts={parts} />
        </Fragment>
      ))}
      <span aria-hidden="true"> · </span>
      <button type="button" className="sources-line__more" onClick={onMore}>
        {t('sources.more')}
      </button>
    </footer>
  )
}
