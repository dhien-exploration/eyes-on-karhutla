import type { Manifest } from '../data'
import { useI18n } from '../i18n/context'
import { linkify, type Credit as CreditParts } from '../map/attribution'
import { Credit } from './Credit'

/** Drawer section: the full credits, from the manifest and the basemap tiles. */
export function SourcesSection({ manifest, basemap }: { manifest: Manifest; basemap: CreditParts[] }) {
  const { t } = useI18n()
  return (
    <section id="sources" className="drawer__section sources" aria-labelledby="sources-title">
      <h2 id="sources-title" className="drawer__heading">
        {t('sources.title')}
      </h2>
      <ul>
        {manifest.attribution.map((line) => (
          <li key={line}>
            <Credit parts={linkify(line)} />
          </li>
        ))}
        {basemap.map((parts, i) => (
          <li key={i}>
            {t('sources.basemap')}: <Credit parts={parts} />
          </li>
        ))}
      </ul>
    </section>
  )
}
