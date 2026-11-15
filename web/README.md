# Eyes on Karhutla: web

**Harmonization of MODIS and VIIRS hot spots** for Indonesian forest and land fires
(*karhutla*). This is the public, read-only map of historical burning activity across Indonesia.

This is the `web/` package of the `eyes-on-karhutla` monorepo. It loads, validates and displays
the data products exported by `../pipeline`, and does no scientific processing itself.

## What it shows

- All 34 provinces on one map, coloured by **active cell-days** for one sensor at a time (MODIS or
  VIIRS S-NPP). The two sensors are shown side by side and never summed.
- Hover a province for its numbers; select one to fly in and see its active cells as dots,
  coloured by sensor agreement. Click a dot for its detection dates per sensor.
- A year picker (or "Semua tahun") and a monthly chart covering every year.
- Every view is a link: the address bar follows the province, year, sensor and dot, and the menu can
  copy the link or a citation that records which data export it showed.
- Notes on the metric, coverage gaps and boundaries, in Bahasa Indonesia (default) and English.

Hotspots are detections of thermal anomalies, not confirmed fires.

## Stack

TypeScript, Vite, React, [MapLibre GL JS](https://maplibre.org/) with
[OpenFreeMap](https://openfreemap.org/) tiles (no API key), uPlot for charts, Vitest and
Playwright for tests, oxlint for linting.

## Setup

```bash
npm install
```

The app needs exported data in `public/data/v1/`. Generate it from the pipeline (see
[`../pipeline/README.md`](../pipeline/README.md) for pulling FIRMS data first):

```bash
cd ../pipeline
uv run python -m eyes_on_karhutla.export --out ../web/public/data/v1
```

Exported data is git-ignored. Only the JSON Schemas in `public/data/v1/schema/` are committed,
because they define the data contract.

## Commands

```bash
npm run dev          # dev server
npm run build        # typecheck + production build into dist/
npm run preview      # serve the production build
npm test             # unit tests (Vitest)
npm run test:e2e     # end-to-end tests (Playwright; skipped without public/data/v1)
npm run typecheck
npm run lint
npm run gen:data     # regenerate src/data/generated/ from the schemas
npm run check:data   # fail if src/data/generated/ is out of date
```

Before the first e2e run, install the browser with `npx playwright install chromium`.

## Data contract

The pipeline owns the schema. After an export changes `public/data/v1/schema/`, run
`npm run gen:data` to regenerate the TypeScript types and validators in `src/data/generated/`
(never edit those by hand). The app accepts `schema_version` `1.x` and shows an error state for
anything else or for data that fails validation. Layout and rules: [`AGENTS.md`](AGENTS.md) §6.

## Project layout

```text
src/
├── data/        # loading + validating data products, generated contract types
├── map/         # MapLibre setup, choropleth, cell dots, attribution
├── chart/       # monthly chart data
├── components/  # drawer, pickers, legend, panels
├── i18n/        # id + en strings
└── styles/
tests/
├── unit/        # Vitest + Testing Library
└── e2e/         # Playwright
```

## Attribution

Hotspot data: NASA FIRMS (MODIS and VIIRS). Province boundaries: geoBoundaries, from
OpenStreetMap data under ODbL 1.0. Basemap: OpenFreeMap, © OpenMapTiles, © OpenStreetMap
contributors. The app shows a short credit line on the map and the full wording in the ☰ menu.
