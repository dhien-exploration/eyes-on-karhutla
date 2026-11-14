# Eyes on Karhutla

NASA Space Apps Challenge 2026: **Harmonization of MODIS and VIIRS Hot Spots**, focused on
Indonesian forest and land fires (*karhutla*).

| Folder | Language | Role |
|---|---|---|
| [`pipeline/`](pipeline/) | Python (uv) | Scientific source of truth: FIRMS ingestion, MODIS–VIIRS harmonization, activity metrics, research notebooks, internal Streamlit tool, and export of versioned data products. |
| [`web/`](web/) | TypeScript (npm, Vite) | Public map (React + MapLibre). Reads the exported data products; no scientific processing. |

```mermaid
flowchart LR
    FIRMS[NASA FIRMS] --> PY[pipeline/<br/>Python + tests]
    PY -->|data products v1| DATA[(static data files)]
    DATA --> WEB[web/<br/>MapLibre UI]
```

Hotspots are detections of thermal anomalies, not confirmed fires. Generated data is never
committed. See `pipeline/README.md` to pull FIRMS data and export it.

## Tech stack

- **Data sources:** NASA FIRMS (MODIS, VIIRS), geoBoundaries
- **Data processing:** Python 3.12, pandas, NumPy, GeoPandas, Shapely
- **Data contract:** JSON Schema, jsonschema, Ajv, json-schema-to-typescript
- **Research & internal tools:** JupyterLab, Streamlit, Plotly, Folium
- **Web app:** TypeScript, React, Vite
- **Maps & charts:** MapLibre GL JS, OpenFreeMap, uPlot
- **Testing & quality:** pytest, Vitest, Testing Library, Playwright, oxlint
- **Tooling:** uv, npm, Git, GitHub
- **Docs & AI workflow:** Lode Coding, AGENTS.md, Markdown, Mermaid
