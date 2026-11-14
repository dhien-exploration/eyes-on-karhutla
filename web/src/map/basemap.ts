import { useMediaQuery } from '../hooks/useMediaQuery'

// OpenFreeMap: no API key, no registration, commercial use allowed. Its
// attribution ("OpenFreeMap © OpenMapTiles Data from OpenStreetMap") comes from
// the tile metadata and is shown by MapLibre's attribution control.
export const BASEMAP_STYLES = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
} as const

export type ColorScheme = keyof typeof BASEMAP_STYLES

/** Follows the operating system's light/dark preference. */
export function useColorScheme(): ColorScheme {
  return useMediaQuery('(prefers-color-scheme: dark)') ? 'dark' : 'light'
}
