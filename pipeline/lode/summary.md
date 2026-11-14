# Project Summary

Eyes on Karhutla is a Python prototype for NASA Space Apps 2026 ("Harmonization of
MODIS and VIIRS Hot Spots"), focused on Indonesian forest and land fires. It aims to turn NASA FIRMS
MODIS and VIIRS detections into a **harmonized historical burning activity calendar**, with
transparent data quality and, later, anomaly analysis. Shared logic lives in `src/eyes_on_karhutla/` and is
used by both JupyterLab notebooks and a Streamlit app. **Current state:** project scaffold on uv and
Python 3.12. FIRMS area-API ingestion (`ingestion.py`) and schema normalization
(`preprocessing.py`) work and have tests. `harmonization.py` builds 0.01° active cell-days on WIB dates (`type == 0`, all confidence levels,
low-only flag) and has tests. Cell-days carry per-platform flags. Notebook 02 shows VIIRS stays about 5.5× MODIS
(sensitivity), so `activity.py` reports **side-by-side series** with fixed constellations
(MODIS Terra + Aqua, VIIRS S-NPP), never summed, as daily or W/M/Y periods with coverage flags.
`pipeline.run_local` chains the whole flow for the app and notebooks. `app.py` is a working
Streamlit page with an activity calendar, a MODIS/S-NPP agreement map and a method and data-quality
tab ([app](app/summary.md)). It is an **internal tool**. This package is `pipeline/` in the
Dhien Exploration monorepo `dhien-exploration/eyes-on-karhutla`; the public product is the JS
package `web/` (MapLibre) next to it, which reads data products exported from here
(AGENTS.md §13; [clickable-map](plans/clickable-map.md)). `regions.py` assigns cell-days to 34
provinces. `export.py` writes the one data contract, **v1** (multi-year), from the raw archive (`archive.py`, `data/raw/firms/`, `pipeline.run_archive`): daily
and monthly series with complete/partial/missing status, per-year cell files, and Indonesia =
sum of provinces ([export](export/summary.md), [multi-year-archive](export/multi-year-archive.md);
plan in `docs/README.md`). Archive: 2012-01-20 → 2026-06-30, all four SP sources (1.6 GB); full export validated. Post-hackathon vision: moderated
community reports ([vision-community](plans/vision-community.md)). The reference dataset is a real FIRMS SP
sample for Aug–Oct 2019 (MODIS, VIIRS S-NPP, VIIRS NOAA-20; about 800k detections), explored in
`notebooks/01_explore_nasa_data.ipynb` and `02_compare_modis_viirs.ipynb`. The SiPongi+ comparison has not been researched yet.

```mermaid
flowchart LR
    FIRMS[NASA FIRMS API / CSV] --> I[ingestion.py ✅]
    I --> P[preprocessing.py ✅]
    P --> H[harmonization.py 🟡]
    H --> A[activity.py 🟡]
    A --> NB[JupyterLab]
    A --> V[visualization.py ✅]
    V --> ST[Streamlit app.py 🟡]
```

```bash
uv sync && uv run pytest   # 67 tests: ingestion, preprocessing, harmonization, activity, visualization, regions, archive, export
uv run streamlit run app.py          # internal tool
uv run python -m eyes_on_karhutla.archive pull --start 2019-01-01 --end 2020-12-31
uv run python -m eyes_on_karhutla.export --out ../web/public/data/v1   # run from pipeline/
```

Related: [lode-map](lode-map.md) · [roadmap](plans/roadmap.md) · [data](data/summary.md) ·
[harmonization](harmonization/summary.md)
