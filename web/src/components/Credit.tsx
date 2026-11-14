import type { Credit as CreditParts } from '../map/attribution'

/** Renders credit parts as text and external links. */
export function Credit({ parts }: { parts: CreditParts }) {
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {i > 0 && ' '}
          {part.href ? (
            <a href={part.href} target="_blank" rel="noreferrer">
              {part.text}
            </a>
          ) : (
            part.text
          )}
        </span>
      ))}
    </>
  )
}
