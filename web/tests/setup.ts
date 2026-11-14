import '@testing-library/jest-dom/vitest'

// Node 25 ships its own (file-backed) localStorage, which shadows jsdom's.
// Give tests a plain in-memory Storage instead.
class MemoryStorage implements Storage {
  private data = new Map<string, string>()
  get length() { return this.data.size }
  clear() { this.data.clear() }
  getItem(key: string) { return this.data.get(key) ?? null }
  key(index: number) { return [...this.data.keys()][index] ?? null }
  removeItem(key: string) { this.data.delete(key) }
  setItem(key: string, value: string) { this.data.set(key, String(value)) }
}

Object.defineProperty(window, 'localStorage', { value: new MemoryStorage(), configurable: true })

// jsdom has no matchMedia. Tests run as light mode with no motion preference.
Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList,
})

// jsdom does not implement scrolling.
Element.prototype.scrollIntoView = () => {}
Element.prototype.scrollTo = () => {}
