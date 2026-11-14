import type { Manifest } from '../data'

/** One piece of a credit: plain text, or a link. */
export interface CreditPart {
  text: string
  href?: string
}
export type Credit = CreditPart[]

const isWebUrl = (href: string | null): href is string => !!href && /^https?:\/\//.test(href)

/**
 * Turns a tile source's attribution HTML (e.g. OpenFreeMap's TileJSON) into
 * text and links, so it can be rendered as React elements and never as raw HTML.
 */
export function parseAttribution(html: string): Credit {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
  const parts: Credit = []
  for (const node of doc.body.firstElementChild?.childNodes ?? []) {
    const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (!text) continue
    const href = node instanceof HTMLAnchorElement ? node.getAttribute('href') : null
    parts.push(isWebUrl(href) ? { text, href } : { text })
  }
  return parts
}

const firstUrl = (s: string | undefined) => s?.match(/https?:\/\/\S+?(?=[,;\s]|$)/)?.[0]

/**
 * The short data credits for the one-line sources bar. The full wording stays in
 * manifest.attribution and is shown in the drawer's "Sumber data" section.
 */
export function shortDataCredits(manifest: Manifest): Credit[] {
  const firms = manifest.attribution.find((a) => a.includes('FIRMS'))
  const licence = manifest.boundaries.license.match(/\(([^)]+)\)\s*$/)?.[1] ?? manifest.boundaries.license
  return [
    [{ text: 'NASA FIRMS', href: firstUrl(firms) }],
    [{ text: `geoBoundaries (${licence})`, href: manifest.boundaries.url }],
  ]
}

/** Splits a plain credit string into text and links (bare URLs become links). */
export function linkify(text: string): Credit {
  return text
    .split(/(https?:\/\/\S+?)(?=[,;\s]|$)/)
    .filter(Boolean)
    .map((piece) => (isWebUrl(piece) ? { text: piece, href: piece } : { text: piece }))
}
