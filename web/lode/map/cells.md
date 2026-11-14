# Cell Dots (`src/map/cells.ts`, `DotsSection`, `CellDetail`)

Owner decisions (2026-10-24): dots are coloured by **sensor agreement**, a dot's detail opens **in the drawer**, and cells seen **only by other VIIRS satellites** are **hidden by default** behind an opt-in switch.

Selecting a province **with a year picked** lazy-loads `cells/{YYYY}.geojson` (`useCells(province, year)`, validated), draws one dot per cell active that year, and fades that province's fill. With "Semua tahun" there are no dots (the drawer says to pick a year). Going back to Indonesia, or changing the year, replaces or empties the source and clears the picked dot.

```mermaid
flowchart LR
    SEL[selectedId] --> UC[useCells: lazy load + validate]
    UC --> SD[cellsSourceData: flat cell_id/cat/low]
    SD --> L[cells-dot · cells-ring · cells-selected, under labels]
    UC --> IX[indexCellRecords: cell_id → arrays + centre]
    L -->|click, 10 px box| CS[selectedCellId]
    CS --> IX --> CD[CellDetail at the top of the drawer]
```

## Categories (`cellCategory`, from exported per-cell counts, complete WIB dates only)
| Category | Rule | Map style |
|---|---|---|
| `both` | `modis_days > 0 && viirs_snpp_days > 0` | filled `--c-both` |
| `modis` | MODIS only | filled `--c-modis` |
| `viirs_snpp` | VIIRS S-NPP only | filled `--c-viirs` |
| `other_viirs` | only `viirs_all_days > 0` | hollow orange ring; **only with the switch on** |
| `partial` | `n_active_days == 0` | hollow ring `--c-map-partial` |

- `isLowConfidenceOnly`: every *complete* date is `low_conf_only`. Dots at 0.4 opacity, rings at 0.5.
- Notes in the drawer: "both" = within the period, not necessarily the same date; same-cell agreement understates true agreement.
- With the switch off, the drawer states how many cells are hidden (`countCategory(cells, 'other_viirs')`, e.g. 5.283 in ID-KB). National 2019 share: 26 %.
- In the detail table, "other VIIRS on this date" = `viirs_all[i] && !viirs_snpp[i]`. Verified on all 322,719 exported cell-dates: `viirs_snpp` ⇒ `viirs_all`.

```ts
cellCategory({ n_active_days: 2, modis_days: 1, viirs_snpp_days: 1, … }) // 'both'
otherViirsPlatforms(manifest) // 'NOAA-20, NOAA-21' (viirs_all.platforms − viirs_snpp.platforms)
```

## Instrument-agnostic
No satellite names are hard-coded in UI text. The other-VIIRS label and the switch use `otherViirsPlatforms(manifest)`. The warning is a translated general sentence plus `manifest.series_notes.viirs_all` (shown as quoted data text, `lang="en"`). A 2022 export with NOAA-21 needs no code change. The multi-year contract questions are in [../plans/roadmap.md](../plans/roadmap.md).

## Map (IndonesiaMap)
- `cells` source: GeoJSON with **flat** properties only (`cell_id`, `cat`, `low`), because MapLibre stringifies arrays. Details always come from `indexCellRecords`, which keeps the arrays and the **exported point geometry as the centre**. Never derive the centre from `cell_id`: the id holds the cell's *lower edge* index (`-107_10256` sits at lat −1.065).
- Layers (above `provinces-line`, below the basemap labels): `cells-dot` (filled categories), `cells-ring` (filter `partial`, plus `other_viirs` when switched on), `cells-selected` (accent ring, filter `cell_id == selected`).
- Radius by zoom: 1.4 px at z4 → 9 px at z13. `dotRadius(extra)` adds the offset at every stop, because MapLibre only allows `zoom` at the top of an `interpolate` (`['+', interpolate, 5]` fails validation).
- One map `click` handler: a dot under a 10 px box around the pointer wins. Otherwise a province click selects that province, or clears the cell when it is the selected one. No hover card over the selected province.
- Effects: `cells` → `setData`, `showOtherViirs` → ring filter, `selectedCellId` → highlight filter.

## Drawer and legend
- Order: **CellDetail** (when a dot is selected; the drawer scrolls to the top) → Province → **Monthly chart** ([../chart/monthly.md](../chart/monthly.md)) → **Dots** (key, notes, switch, hidden count, loading/error with retry) → colour the map → about the data → sources.
- `CellDetail`: coordinates (locale-formatted), category, active days per sensor (`SeriesFigures` small), a table `Tanggal (WIB) | MODIS | VIIRS S-NPP | [VIIRS lain] | Catatan` with ✓/· (`aria-label` "terdeteksi/tidak terdeteksi"). Partial rows are italic and tagged "parsial"; low-confidence dates are tagged "keyakinan rendah".
- The **mini legend switches to the dot key** (both / MODIS / VIIRS S-NPP / partial) while a province **and a year** are selected (a 2×2 grid on phones).
- Selecting another province, or going back, clears the selected dot.

## Performance (dev server, headless Chromium)
ID-KB (20,591 cells, 8 MB raw): fetched, validated and in the map source in **≈0.4–0.5 s**. The map settles at ≈1.1 s, including the 1 s fly-in. A plain circle layer is enough; no deck.gl.

## Later: time control
Date filtering must re-filter the loaded cells in code and `setData`; it cannot use map expressions on the date arrays (stringified).

## Tests
- `tests/unit/cells.test.ts`: categories, low-confidence (complete dates only), flat source data, records (arrays + centre), counts, platform names (including a NOAA-20-only export).
- `tests/unit/app.test.tsx`: dots only for the selected province + key + hidden count + mini-legend dot key; loading → error → retry; dot detail rows, ticks and the partial tag, then close; the switch with the manifest warning; the detail clears on province change.
- `tests/e2e/map.spec.ts`: ID-KB dots in < 5 s under the labels, removed on back; a real dot click → detail rows, province kept, highlight filter; the switch adds `other_viirs` to the ring filter.

Related: [summary.md](summary.md), [choropleth.md](choropleth.md), [../ui/layout.md](../ui/layout.md), [../data/data-products.md](../data/data-products.md)
