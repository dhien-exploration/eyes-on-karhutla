import { fireEvent, render, screen } from '@testing-library/react'
import { LanguageSwitch } from '../../src/components/LanguageSwitch'
import { useI18n } from '../../src/i18n/context'
import { I18nProvider } from '../../src/i18n/I18nProvider'
import { STRINGS } from '../../src/i18n/strings'

function Probe() {
  const { t, formatNumber, formatDate } = useI18n()
  return (
    <>
      <p>{t('app.tagline')}</p>
      <p data-testid="number">{formatNumber(63725)}</p>
      <p data-testid="date">{formatDate('2019-08-01')}</p>
      <p data-testid="vars">{t('year.partial', { year: 2019 })}</p>
    </>
  )
}

function renderSwitch() {
  return render(
    <I18nProvider>
      <LanguageSwitch />
      <Probe />
    </I18nProvider>,
  )
}

describe('language switch', () => {
  beforeEach(() => window.localStorage.clear())

  it('defaults to Bahasa Indonesia', () => {
    renderSwitch()
    expect(screen.getByText(STRINGS.id['app.tagline'])).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ID' })).toHaveAttribute('aria-pressed', 'true')
    expect(document.documentElement.lang).toBe('id')
  })

  it('switches to English and remembers the choice', () => {
    const { unmount } = renderSwitch()
    fireEvent.click(screen.getByRole('button', { name: 'EN' }))
    expect(screen.getByText(STRINGS.en['app.tagline'])).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('en')

    unmount()
    renderSwitch()
    expect(screen.getByRole('button', { name: 'EN' })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('formatting', () => {
  beforeEach(() => window.localStorage.clear())

  it('formats numbers, dates and placeholders per language', () => {
    renderSwitch()
    expect(screen.getByTestId('number')).toHaveTextContent('63.725')
    expect(screen.getByTestId('date')).toHaveTextContent('1 Agu 2019')
    expect(screen.getByTestId('vars')).toHaveTextContent('2019 (parsial)')

    fireEvent.click(screen.getByRole('button', { name: 'EN' }))
    expect(screen.getByTestId('number')).toHaveTextContent('63,725')
    expect(screen.getByTestId('date')).toHaveTextContent('1 Aug 2019')
  })

  it('keeps calendar dates on their day regardless of the time zone', () => {
    renderSwitch()
    expect(screen.getByTestId('date')).toHaveTextContent(/^1 /)
  })
})

describe('strings', () => {
  it('has a non-empty English string for every key', () => {
    for (const key of Object.keys(STRINGS.id) as (keyof typeof STRINGS.id)[]) {
      expect(STRINGS.en[key]).toBeTruthy()
    }
  })

  it('uses the same placeholders in both languages', () => {
    const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    for (const key of Object.keys(STRINGS.id) as (keyof typeof STRINGS.id)[]) {
      expect(placeholders(STRINGS.en[key]), key).toEqual(placeholders(STRINGS.id[key]))
    }
  })
})
