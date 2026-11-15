import { useEffect, useRef, useState } from 'react'
import type { Manifest } from '../data'
import { useI18n } from '../i18n/context'
import type { ColorBy } from '../map/choropleth'
import type { Year } from '../map/years'
import { allYearsLabel, citation, viewUrl } from '../share/view'

interface Props {
  manifest: Manifest
  provinceId: string | null
  provinceName: string | null
  year: Year
  colorBy: ColorBy
  cellId: string | null
  showOtherViirs: boolean
}

type Copied = { kind: 'link' | 'citation'; ok: true } | { kind: 'link' | 'citation'; ok: false; text: string }

/** Drawer section: copy a link to the current view, or a citation that records the data version. */
export function ShareSection({ manifest, provinceId, provinceName, year, colorBy, cellId, showOtherViirs }: Props) {
  const { t } = useI18n()
  const [copied, setCopied] = useState<Copied | null>(null)
  const manual = useRef<HTMLTextAreaElement>(null)

  // The success line fades after a moment; a manual-copy field stays until the next copy.
  useEffect(() => {
    if (!copied?.ok) return
    const timer = setTimeout(() => setCopied(null), 2500)
    return () => clearTimeout(timer)
  }, [copied])

  useEffect(() => {
    if (copied && !copied.ok) manual.current?.select()
  }, [copied])

  // Year and sensor are always explicit, so the link does not drift as data is added.
  const url = () =>
    viewUrl(
      { province: provinceId, year, sensor: colorBy, cell: year === null ? null : cellId, other: showOtherViirs },
      window.location,
    )

  const citationText = () =>
    citation(manifest, {
      title: t('app.title'),
      place: provinceName ?? t('panel.national'),
      yearLabel: year ?? allYearsLabel(manifest, t('year.all')),
      seriesLabel: manifest.series[colorBy].label,
      metricLabel: t('metric.label'),
      cellLabel: provinceId && cellId && year !== null ? t('share.cell', { cell: cellId }) : null,
      exportLabel: t('share.export'),
      accessedLabel: t('share.accessed'),
      url: url(),
      accessed: new Date(),
    })

  const copy = async (kind: 'link' | 'citation') => {
    const text = kind === 'link' ? url() : citationText()
    try {
      if (!navigator.clipboard) throw new Error('no clipboard')
      await navigator.clipboard.writeText(text)
      setCopied({ kind, ok: true })
    } catch {
      setCopied({ kind, ok: false, text })
    }
  }

  return (
    <section className="drawer__section share" aria-labelledby="share-title">
      <h2 id="share-title" className="drawer__heading">
        {t('share.title')}
      </h2>
      <p className="share__hint">{t('share.hint')}</p>
      <div className="share__actions">
        <button type="button" onClick={() => copy('link')}>
          {t('share.copyLink')}
        </button>
        <button type="button" onClick={() => copy('citation')}>
          {t('share.copyCitation')}
        </button>
      </div>
      <p className="share__status" aria-live="polite">
        {copied?.ok && t(copied.kind === 'link' ? 'share.copiedLink' : 'share.copiedCitation')}
      </p>
      {copied && !copied.ok && (
        <label className="share__manual">
          <span>{t('share.manual')}</span>
          <textarea ref={manual} readOnly value={copied.text} rows={copied.kind === 'link' ? 2 : 5} />
        </label>
      )}
    </section>
  )
}
