# Eyes on Karhutla: pipeline

**Harmonization of MODIS and VIIRS hot spots** for Indonesian forest and land fires
(*karhutla*). The goal is a consistent, explainable historical burning activity calendar built
from harmonized MODIS and VIIRS detections.

This is the `pipeline/` package of the `eyes-on-karhutla` monorepo: the Python scientific source
of truth (ingestion, harmonization, activity metrics, data-product export). The public map lives in `../web`.

How the pipeline and its data contract are designed (data flow, file layout, publishing plan, open
questions): [`docs/architecture.md`](docs/architecture.md).

## Stack

Python 3.12 managed with [uv](https://docs.astral.sh/uv/). pandas and NumPy for tabular work,
GeoPandas and Shapely for geometry and province assignment, requests and python-dotenv for the
NASA FIRMS API, and jsonschema to validate exported data products. JupyterLab for research
notebooks, Streamlit with Plotly and Folium for the internal analysis tool, and pytest for tests.

## Setup

```bash
uv sync                                       # Python 3.12 + dependencies
cp .env.example .env                          # then add your FIRMS_MAP_KEY
uv run pytest                                 # tests
uv run jupyter lab                            # research notebooks (notebooks/)
uv run streamlit run app.py                   # internal analysis tool
uv run streamlit run spikes/province_click.py # internal analysis tool with clickable province
```

## Exporting data for the web app

The public map (`../web` in this monorepo) reads data files that this package exports (contract
v1, multi-year). All commands run from `pipeline/` and need `FIRMS_MAP_KEY` in `.env`.

### 1. Get province boundaries (once)

```bash
mkdir -p data/raw/boundaries
curl -L -o data/raw/boundaries/geoBoundaries-IDN-ADM1_simplified.geojson \
  https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/IDN/ADM1/geoBoundaries-IDN-ADM1_simplified.geojson
```

These are geoBoundaries / OpenStreetMap boundaries under **ODbL 1.0**. They describe 34 provinces as
of 2017, not the current 38.

### 2. See what FIRMS has and what you already have

```bash
uv run python -m eyes_on_karhutla.archive status
```

This shows each source's FIRMS archive range next to the local files in `data/raw/firms/`, the
covered periods, and the default pull end (the last date that both MODIS and VIIRS S-NPP have).

### 3. Pull years into the local archive

```bash
uv run python -m eyes_on_karhutla.archive pull --start 2019-01-01 --end 2020-12-31 --dry-run  # show the plan
uv run python -m eyes_on_karhutla.archive pull --start 2019-01-01 --end 2020-12-31            # fetch
uv run python -m eyes_on_karhutla.archive pull --start 2012-01-01                             # up to the archive end
```

- Files go to `data/raw/firms/{source}/{start}_{end}.csv`, one per source per UTC year. They are
  git-ignored and never edited.
- Years you already have are skipped. A partial year (e.g. 2026 so far) is replaced by a fuller
  pull later.
- Each source-year is about 73 API calls (FIRMS allows 5000 per 10 minutes). 2019–2020 for three
  sources is about 440 calls.
- Sources: MODIS and VIIRS S-NPP are **required**: a date counts as covered only if both have it.
  VIIRS NOAA-20 (2018-) and NOAA-21 (2023-) are optional, and only affect the "VIIRS all" series.

### 4. Trial export (safe, stays inside `pipeline/`)

```bash
uv run python -m eyes_on_karhutla.export --out data/processed/export-trial/v1
uv run python -m eyes_on_karhutla.export --start 2019-01-01 --end 2019-12-31 \
  --out data/processed/export-trial/v1   # optionally narrow the years (UTC dates)
```

`data/processed/` is git-ignored. One year takes about 35 s. Output layout (every path is also
listed in `manifest.json`):

```text
manifest.json, schema/, provinces.geojson, monthly.json (Indonesia)
provinces/{id}/daily.json      # every date, status complete | partial | missing (null values when missing)
provinces/{id}/monthly.json    # every month, same status rule
provinces/{id}/cells/{year}.geojson
```

"Indonesia" totals are the sum of the provinces. Detections in the bounding box but outside every
province are reported separately as `outside_provinces`. The export refuses to write anything if a
schema check or a totals cross-check fails.

### 5. Check the result

```bash
uv run python - <<'PY'
import json
out = "data/processed/export-trial/v1"
m = json.load(open(f"{out}/manifest.json"))
print("schema", m["schema_version"], "| years", m["coverage"]["years"])
print("Indonesia by year", m["totals"]["indonesia_by_year"])
print("outside provinces by year", m["totals"]["outside_provinces_by_year"])
PY
```

To look at the data on a map, open `provinces.geojson` or any `provinces/<id>/cells/<year>.geojson`
in QGIS or another GeoJSON viewer.

### 6. Export into the web app

```bash
uv run python -m eyes_on_karhutla.export --out ../web/public/data/v1
```

`web/public/data/` is git-ignored, because the data is generated and not committed. Rerun the
command whenever the data changes.

### Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| `ValueError: No covered periods in the archive` | Nothing pulled yet, or MODIS and S-NPP don't overlap in the requested range | Run `archive status`, then `archive pull` |
| `ValueError: Overlapping archive files` / `Unexpected file in the archive` | A file in `data/raw/firms/` was added or renamed by hand | Remove the extra file; let `archive pull` manage that folder |
| `ValueError: ... several partial files` | A year has more than one partial file | Delete that year's files for that source and pull it again |
| `DataSourceError` / no such file `...geoBoundaries...` | Boundaries missing | Run step 1 |
| `FileExistsError: ... is not a previous export` | `--out` points to a folder with other files | Choose an empty folder or a previous export folder. The exporter never deletes unrelated folders. |
| `ValueError: ... fails the ... schema` | The exported data breaks the contract | Treat it as a bug: nothing was written. Check recent pipeline changes. |
| `AssertionError: ... do not add up` / `differs from the sum of provinces` | A cross-file totals check failed | Treat it as a bug: nothing was written |
| `RuntimeError: FIRMS_MAP_KEY is not set` | No API key | Copy `.env.example` to `.env` and add your key |

## Single-range files for the internal tools

The Streamlit app (`app.py`), `spikes/province_click.py` and the notebooks use `pipeline.run_local`,
which reads one single-range raw file per source directly in `data/raw/` (not the archive). To
create them (92 days take about 1 minute):

```bash
uv run python - <<'PY'
from datetime import date
from eyes_on_karhutla import config, ingestion

start, end = date(2019, 8, 1), date(2019, 10, 31)   # UTC dates, inclusive
for source in ["MODIS_SP", "VIIRS_SNPP_SP", "VIIRS_NOAA20_SP"]:
    df = ingestion.fetch_area(source, config.INDONESIA_BBOX, start, end)
    print(source, len(df), "rows ->", ingestion.save_raw(df, f"{source.lower()}_{start}_{end}"))
PY
```

All three files must cover the same range; the newest file per source is used.

## Layout

- `src/eyes_on_karhutla/`: shared logic used by both the notebooks and Streamlit
  (ingestion → preprocessing → harmonization → regions → activity → export / visualization)
- `docs/architecture.md`: data flow, data contract, publishing plan, open questions
- `notebooks/`: exploration and validation
- `tests/`: pytest for the reusable logic
- `data/raw`, `data/processed`: local data (not committed)
- `lode/`: project knowledge base (design, terminology, plans)

## Data sources & attribution

- NASA FIRMS (MODIS Collection 6.1, VIIRS 375 m): https://firms.modaps.eosdis.nasa.gov/
- SiPongi+ (KLHK/Kemenhut) for comparison only. Data from SiPongi+ must cite **SIPONGI KEMENHUT**.

Hotspots are detections of thermal anomalies, not confirmed fire incidents.
