"""Export versioned data products (contract v1, multi-year) for the public web app.

Layout (lode/export/summary.md; every path is listed in the manifest):

    {out}/manifest.json
    {out}/schema/{manifest,provinces,daily,monthly,cells}.schema.json
    {out}/provinces.geojson                      # totals, totals_by_year, n_active_cells_by_year
    {out}/monthly.json                           # Indonesia (sum of provinces)
    {out}/provinces/{id}/daily.json              # every date in range, with status
    {out}/provinces/{id}/monthly.json            # every month in range, with status
    {out}/provinces/{id}/cells/{YYYY}.geojson    # one WIB year of active cells

Rules: "Indonesia" = the provinces; cells outside every province are reported
separately. Statuses are complete | partial | missing, and values are null when
missing (never 0). Totals and monthly/yearly values sum complete WIB dates only.

Each document is validated against its JSON Schema as it is written to a temporary
directory, which replaces ``out`` only after everything succeeded.

Run: uv run python -m eyes_on_karhutla.export --out ../web/public/data/v1
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import shutil
import subprocess
from pathlib import Path

import geopandas as gpd
import jsonschema
import pandas as pd
import shapely

from eyes_on_karhutla import __version__, activity, config, pipeline, regions

SCHEMA_VERSION = "1.0.0"
METRIC = "active_cell_days"
SIMPLIFY_DEG = 0.005      # display geometry only; assignment uses the unsimplified shapes
COORD_PRECISION = 1e-4    # ~11 m, well below the 0.01° grid
SERIES = tuple(activity.SERIES)

# ---- JSON Schemas (the contract; the web app generates TS types from these) ----
# Every field the exporter writes is typed here; validate_products() fails on any untyped field.
# Objects allow extra properties on purpose, so additive changes don't break older web builds.

_DRAFT = "https://json-schema.org/draft/2020-12/schema"
_STR = {"type": "string"}
_BOOL = {"type": "boolean"}
_COUNT = {"type": "integer", "minimum": 0}
_NULLABLE_COUNT = {"type": ["integer", "null"], "minimum": 0}
_DATE = {"type": "string", "format": "date", "pattern": r"^\d{4}-\d{2}-\d{2}$"}
_MONTH = {"type": "string", "pattern": r"^\d{4}-\d{2}$"}
_DATETIME = {"type": "string", "format": "date-time", "pattern": r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}"}
_ID = {"type": "string", "pattern": r"^[A-Z]{2}-[A-Z0-9]{1,3}$"}
_PROVINCE_ID_OR_NULL = {"type": ["string", "null"], "pattern": _ID["pattern"]}
_PATH = {"type": "string", "pattern": r"^[A-Za-z0-9_.-]+(/[A-Za-z0-9_.-]+)*$"}
_STATUS = {"enum": list(activity.STATUSES)}
_POSITION = {
    "type": "array", "minItems": 2, "maxItems": 2,
    "prefixItems": [{"type": "number", "minimum": -180, "maximum": 180},
                    {"type": "number", "minimum": -90, "maximum": 90}],
    "items": {"type": "number"},
}
_RING = {"type": "array", "minItems": 4, "items": _POSITION}
_POLYGON_COORDS = {"type": "array", "minItems": 1, "items": _RING}


def _array_of(item, **extra):
    return {"type": "array", "items": item, **extra}


def _obj(properties: dict, optional: tuple[str, ...] = ()) -> dict:
    """Object schema where every listed property is typed and required unless optional."""
    return {"type": "object", "required": [k for k in properties if k not in optional], "properties": properties}


def _by_year(value: dict) -> dict:
    return {"type": "object", "propertyNames": {"pattern": r"^\d{4}$"}, "additionalProperties": value}


def _by_month(value: dict) -> dict:
    return {"type": "object", "propertyNames": {"pattern": r"^\d{4}-\d{2}$"}, "additionalProperties": value}


_SERIES_TOTALS = _obj({s: _COUNT for s in SERIES})
_UTC_RANGE = _obj({"start": _DATE, "end": _DATE})
_PROVINCE_GEOMETRY = {
    "oneOf": [
        _obj({"type": {"const": "Polygon"}, "coordinates": _POLYGON_COORDS}),
        _obj({"type": {"const": "MultiPolygon"}, "coordinates": _array_of(_POLYGON_COORDS, minItems=1)}),
    ]
}

SCHEMAS = {
    "manifest": {
        "$schema": _DRAFT,
        "title": "Eyes on Karhutla data manifest",
        **_obj({
            "schema_version": {"const": SCHEMA_VERSION},
            "generated_at": _DATETIME,
            "pipeline": _obj({"package": _STR, "package_version": _STR,
                              "git_commit": {"type": ["string", "null"], "description": "null when the repo has no commit"}}),
            "metric": _obj({"id": {"const": METRIC}, "label": _STR, "definition": _STR, "not": _STR}),
            "grid_deg": {"type": "number", "exclusiveMinimum": 0},
            "day_convention": _STR,
            "year_convention": _STR,
            "coverage": _obj({
                "periods": _array_of(_UTC_RANGE, minItems=1, description="covered UTC ranges; gaps allowed"),
                "first_date": _DATE, "last_date": _DATE,
                "years": _by_year(_STATUS), "months": _by_month(_STATUS),
                "partial_dates": _array_of(_DATE),
                "trimmed": _obj({"dates": _array_of(_DATE), "cell_days": _COUNT, "note": _STR}),
                "note": _STR,
            }),
            "series": _obj({s: _obj({
                "label": _STR,
                "platforms": _array_of({"enum": list(config.PLATFORMS)}, minItems=1),
                "default": _BOOL,
                "platform_periods": {"type": "object", "additionalProperties": _obj({
                    "start": _DATE, "end": {"type": ["string", "null"], "pattern": _DATE["pattern"]},
                })},
            }) for s in SERIES}),
            "series_notes": {"type": "object", "additionalProperties": _STR},
            "sources": _array_of(_obj({
                "source": _STR, "required": _BOOL, "utc_ranges": _array_of(_UTC_RANGE),
                "files": _array_of(_obj({"file": _STR, "start": _DATE, "end": _DATE,
                                         "raw_rows": _COUNT, "kept_rows": _COUNT})),
            })),
            "exclusions": _array_of(_obj({"source": _STR, "year": {"type": "integer"}, "reason": _STR,
                                          "rows": _COUNT})),
            "boundaries": _obj({"name": _STR, "source": _STR, "license": _STR, "year_represented": {"type": "integer"},
                                "url": _STR, "n_provinces": _COUNT, "note": _STR}),
            "totals": _obj({
                "indonesia": _SERIES_TOTALS, "indonesia_by_year": _by_year(_SERIES_TOTALS),
                "outside_provinces": _SERIES_TOTALS, "outside_provinces_by_year": _by_year(_SERIES_TOTALS),
                "note": _STR,
            }),
            "attribution": _array_of(_STR, minItems=1),
            "provinces": _array_of(_obj({"province_id": _ID, "name": _STR, "daily": _PATH, "monthly": _PATH,
                                         "cells": _by_year(_PATH)})),
            "files": _obj({"provinces": _PATH, "monthly": _PATH,
                           "schemas": _obj({k: _PATH for k in ("manifest", "provinces", "daily", "monthly", "cells")})}),
        }),
    },
    "provinces": {
        "$schema": _DRAFT,
        "title": "Province polygons with totals per year",
        **_obj({
            "type": {"const": "FeatureCollection"},
            "features": _array_of(_obj({
                "type": {"const": "Feature"},
                "geometry": _PROVINCE_GEOMETRY,
                "properties": _obj({
                    "province_id": _ID, "name": _STR, "totals": _SERIES_TOTALS,
                    "totals_by_year": _by_year(_SERIES_TOTALS), "n_active_cells_by_year": _by_year(_COUNT),
                }),
            })),
        }),
    },
    "daily": {
        "$schema": _DRAFT,
        "title": "Daily active cell-days for one province: every date in range, with status (parallel arrays)",
        **_obj({
            "schema_version": {"const": SCHEMA_VERSION},
            "province_id": _ID,
            "metric": {"const": METRIC},
            "dates": _array_of(_DATE),
            "status": _array_of(_STATUS),
            **{s: _array_of(_NULLABLE_COUNT) for s in SERIES},
        }),
    },
    "monthly": {
        "$schema": _DRAFT,
        "title": "Monthly active cell-days (sum of complete dates); every month in range, with status",
        **_obj({
            "schema_version": {"const": SCHEMA_VERSION},
            "province_id": _PROVINCE_ID_OR_NULL,
            "scope": {"enum": ["indonesia", "province"]},
            "metric": {"const": METRIC},
            "months": _array_of(_MONTH),
            "status": _array_of(_STATUS),
            **{s: _array_of(_NULLABLE_COUNT) for s in SERIES},
        }),
    },
    "cells": {
        "$schema": _DRAFT,
        "title": "Active 0.01° cells in one province for one WIB year (parallel per-date arrays)",
        **_obj({
            "type": {"const": "FeatureCollection"},
            "schema_version": {"const": SCHEMA_VERSION},
            "province_id": _ID,
            "year": {"type": "integer"},
            "features": _array_of(_obj({
                "type": {"const": "Feature"},
                "geometry": _obj({"type": {"const": "Point"}, "coordinates": _POSITION}),
                "properties": _obj({
                    "cell_id": {"type": "string", "pattern": r"^-?\d+_-?\d+$"},
                    "n_active_days": _COUNT,
                    **{f"{s}_days": _COUNT for s in SERIES},
                    "first_date": _DATE, "last_date": _DATE,
                    "dates": _array_of(_DATE, minItems=1),
                    "complete": _array_of(_BOOL),
                    **{s: _array_of(_BOOL) for s in SERIES},
                    "low_conf_only": _array_of(_BOOL),
                }),
            })),
        }),
    },
}


def kind_of(path: str) -> str:
    if path == "manifest.json":
        return "manifest"
    if path == "provinces.geojson":
        return "provinces"
    if path == "monthly.json" or path.endswith("/monthly.json"):
        return "monthly"
    if path.endswith("/daily.json"):
        return "daily"
    if "/cells/" in path and path.endswith(".geojson"):
        return "cells"
    raise ValueError(f"Unknown product path: {path}")


def untyped_fields(doc, schema: dict, path: str = "") -> list[str]:
    """Paths of fields in ``doc`` that ``schema`` does not type (no type/const/enum/oneOf).

    Lists are checked through their first element: every element is built by the same code.
    """
    if any(k in schema for k in ("type", "const", "enum")):
        pass
    elif "oneOf" in schema:
        matches = [s for s in schema["oneOf"] if jsonschema.Draft202012Validator(s).is_valid(doc)]
        return untyped_fields(doc, matches[0], path) if matches else [path or "<root>"]
    else:
        return [path or "<root>"]
    found: list[str] = []
    if isinstance(doc, dict):
        props, extra = schema.get("properties", {}), schema.get("additionalProperties")
        for key, value in doc.items():
            sub = props.get(key, extra if isinstance(extra, dict) else {})
            found += untyped_fields(value, sub, f"{path}.{key}" if path else key)
    elif isinstance(doc, list) and doc:
        found += untyped_fields(doc[0], schema.get("items", {}), f"{path}[]")
    return found


# ---- Building -----------------------------------------------------------------


def _git_commit() -> str | None:
    try:
        out = subprocess.run(["git", "rev-parse", "HEAD"], cwd=config.PROJECT_ROOT,
                             capture_output=True, text=True, check=True)
        return out.stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return None  # e.g. no commits yet


def _iso(dates) -> list[str]:
    return [d.isoformat() for d in dates]


def _nullable(values) -> list:
    return [None if pd.isna(v) else int(v) for v in values]


def _series_doc(table: pd.DataFrame, labels: list[str], label_key: str, **head) -> dict:
    return {"schema_version": SCHEMA_VERSION, **head, "metric": METRIC, label_key: labels,
            "status": table["status"].tolist(), **{s: _nullable(table[s]) for s in SERIES}}


def _cell_features(cell_days: pd.DataFrame, complete_dates: set, grid_deg: float) -> list[dict]:
    if cell_days.empty:
        return []
    hits = activity.series_hits(cell_days, SERIES)
    df = pd.concat([cell_days[["cell_lat", "cell_lon", "wib_date", "low_conf_only"]], hits], axis=1)
    df = df.sort_values(["cell_lat", "cell_lon", "wib_date"])
    df["complete"] = df["wib_date"].isin(complete_dates)
    df["date"] = df["wib_date"].map(dt.date.isoformat)
    flags = ["complete", "low_conf_only", *SERIES]
    # object dtype keeps plain Python bools, so json.dumps can serialize the lists.
    df[flags] = df[flags].astype(bool).astype(object)
    keys = ["cell_lat", "cell_lon"]
    lists = df.groupby(keys, sort=True).agg(
        dates=("date", list), first_date=("date", "first"), last_date=("date", "last"),
        **{c: (c, list) for c in flags},
    )
    done = df[df["complete"].astype(bool)]
    counts = done.groupby(keys)[list(SERIES)].sum().astype(int).rename(columns=lambda s: f"{s}_days")
    counts["n_active_days"] = done.groupby(keys).size()
    lists = lists.join(counts).fillna(0)
    features = []
    for (lat, lon), r in zip(lists.index, lists.itertuples(index=False)):
        r = r._asdict()
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point",
                         "coordinates": [round(lon + grid_deg / 2, 4), round(lat + grid_deg / 2, 4)]},
            "properties": {
                "cell_id": f"{round(lat / grid_deg)}_{round(lon / grid_deg)}",
                "n_active_days": int(r["n_active_days"]),
                **{f"{s}_days": int(r[f"{s}_days"]) for s in SERIES},
                "first_date": r["first_date"], "last_date": r["last_date"],
                "dates": r["dates"], "complete": r["complete"],
                **{s: r[s] for s in SERIES},
                "low_conf_only": r["low_conf_only"],
            },
        })
    return features


def _year_totals(daily: pd.DataFrame, years: list[int]) -> dict[str, dict[str, int]]:
    yearly = activity.period_series(daily, "Y")
    out = {}
    for y in years:
        row = yearly.loc[pd.Period(str(y), freq="Y")]
        out[str(y)] = {s: int(row[s]) for s in SERIES}
    return out


def _sum_totals(by_year: dict[str, dict[str, int]]) -> dict[str, int]:
    return {s: sum(v[s] for v in by_year.values()) for s in SERIES}


def _platform_periods(seen: dict, platforms, last_covered: dt.date) -> dict:
    final_month = last_covered.replace(day=1)
    return {p: {"start": seen[p][0].isoformat(),
                "end": None if seen[p][1] >= final_month else seen[p][1].isoformat()}
            for p in platforms if p in seen}


def iter_products(
    result: pipeline.ArchiveResult,
    provinces: gpd.GeoDataFrame,
    grid_deg: float = config.HARMONIZATION_GRID_DEG,
    boundaries_meta: dict | None = None,
):
    """Yield ``(relative_path, document)`` one at a time: per-province files first, then
    ``provinces.geojson``, ``monthly.json`` and ``manifest.json``.

    Streaming keeps memory flat across many years. Cross-file invariants are checked
    with running totals; a failure raises before the summary files are yielded.
    """
    meta = boundaries_meta or config.BOUNDARIES
    cd, coverage = result.cell_days, result.coverage
    # Trim edge WIB dates in a year with no complete date: a pull ending 31 Dec UTC touches
    # 1 Jan WIB for 7 hours, which must not become a selectable "year". Recorded, not hidden.
    years_with_complete = {d.year for d in coverage.index[coverage["status"] == "complete"]}
    keep_date = [d.year in years_with_complete for d in coverage.index]
    trimmed_dates = [d for d, k in zip(coverage.index, keep_date) if not k]
    coverage = coverage[keep_date]
    in_kept_years = cd["wib_date"].map(lambda d: d.year in years_with_complete).astype(bool)
    trimmed_cell_days = int((~in_kept_years).sum())
    cd = cd[in_kept_years]
    province_of = regions.assign_provinces(cd, provinces, grid_deg)
    complete_dates = set(coverage.index[coverage["status"] == "complete"])

    year_status = activity.period_series(activity.daily_with_status(cd.iloc[:0], coverage), "Y")["status"]
    month_status = activity.period_series(activity.daily_with_status(cd.iloc[:0], coverage), "M")["status"]
    years = [p.year for p, st in year_status.items() if st != "missing"]
    wib_year = pd.Series([d.year for d in cd["wib_date"]], index=cd.index)

    def daily_of(mask) -> pd.DataFrame:
        return activity.daily_with_status(cd[mask], coverage)

    bbox_daily = daily_of(pd.Series(True, index=cd.index))
    indonesia_daily = daily_of(province_of.notna())
    outside_daily = daily_of(province_of.isna())

    features, index = [], []
    province_monthly_sum = None
    display = provinces.copy()
    display["geometry"] = shapely.set_precision(
        display.geometry.simplify(SIMPLIFY_DEG, preserve_topology=True).to_numpy(), COORD_PRECISION
    )
    for row in display.itertuples(index=False):
        pid, base = row.province_id, f"provinces/{row.province_id}"
        mask = province_of == pid
        daily = daily_of(mask)
        monthly = activity.period_series(daily, "M")
        by_year = _year_totals(daily, years)
        # Invariant: year totals = Σ complete daily = Σ months of that year.
        for y in years:
            in_year = [d.year == y for d in daily.index]
            sel = daily[in_year]
            months_y = monthly[[p.year == y for p in monthly.index]]
            for s in SERIES:
                from_daily = int(sel.loc[sel["status"] == "complete", s].sum())
                from_months = int(months_y[s].fillna(0).sum())
                if not by_year[str(y)][s] == from_daily == from_months:
                    raise AssertionError(f"{pid} {y} {s}: year {by_year[str(y)][s]}, daily {from_daily}, months {from_months}")
        vals = monthly[list(SERIES)].fillna(0)
        province_monthly_sum = vals if province_monthly_sum is None else province_monthly_sum + vals

        yield f"{base}/daily.json", _series_doc(daily, _iso(daily.index), "dates", province_id=pid)
        yield f"{base}/monthly.json", _series_doc(monthly, [str(p) for p in monthly.index], "months",
                                                  province_id=pid, scope="province")
        cells_paths, n_cells = {}, {}
        sub, sub_year = cd[mask], wib_year[mask]
        for y in years:
            cells = _cell_features(sub[sub_year == y], complete_dates, grid_deg)
            path = f"{base}/cells/{y}.geojson"
            yield path, {"type": "FeatureCollection", "schema_version": SCHEMA_VERSION, "province_id": pid,
                         "year": y, "features": cells}
            cells_paths[str(y)], n_cells[str(y)] = path, len(cells)
        features.append({
            "type": "Feature",
            "geometry": json.loads(shapely.to_geojson(row.geometry)),  # lists, exactly as written
            "properties": {"province_id": pid, "name": row.name, "totals": _sum_totals(by_year),
                           "totals_by_year": by_year, "n_active_cells_by_year": n_cells},
        })
        index.append({"province_id": pid, "name": row.name, "daily": f"{base}/daily.json",
                      "monthly": f"{base}/monthly.json", "cells": cells_paths})

    indonesia_monthly = activity.period_series(indonesia_daily, "M")
    # Invariant: Indonesia monthly = Σ province monthly (where not missing).
    if not indonesia_monthly[list(SERIES)].fillna(0).astype(int).equals(province_monthly_sum.astype(int)):
        raise AssertionError("Indonesia monthly series differs from the sum of provinces")
    indonesia_by_year = _year_totals(indonesia_daily, years)
    outside_by_year = _year_totals(outside_daily, years)
    bbox_by_year = _year_totals(bbox_daily, years)
    province_sum_by_year = {str(y): {s: sum(f["properties"]["totals_by_year"][str(y)][s] for f in features)
                                     for s in SERIES} for y in years}
    for y in map(str, years):
        for s in SERIES:
            if not (indonesia_by_year[y][s] == province_sum_by_year[y][s]
                    and indonesia_by_year[y][s] + outside_by_year[y][s] == bbox_by_year[y][s]):
                raise AssertionError(f"Totals do not add up for {y} {s}")

    yield "provinces.geojson", {"type": "FeatureCollection", "features": features}
    yield "monthly.json", _series_doc(indonesia_monthly, [str(p) for p in indonesia_monthly.index], "months",
                                      province_id=None, scope="indonesia")
    last_covered = result.periods[-1][1]
    files_by_source = {s: g for s, g in result.files.groupby("source")}
    yield "manifest.json", {
        "schema_version": SCHEMA_VERSION,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "pipeline": {"package": "eyes-on-karhutla", "package_version": __version__, "git_commit": _git_commit()},
        "metric": {
            "id": METRIC, "label": "Active cell-days",
            "definition": f"Number of {grid_deg}° grid cells with at least one kept FIRMS detection "
                          "(type = 0) on a WIB calendar date, counted per series. Monthly and yearly values "
                          "sum complete WIB dates only.",
            "not": "Not a fire count, burned area, or fire intensity. Detections are thermal anomalies, "
                   "not confirmed fires. MODIS and VIIRS series must never be summed.",
        },
        "grid_deg": grid_deg,
        "day_convention": "WIB (UTC+7) calendar date, nationwide",
        "year_convention": "WIB calendar year (1 Jan 00:00 to 31 Dec 23:59 WIB)",
        "coverage": {
            "periods": [{"start": s.isoformat(), "end": e.isoformat()} for s, e in result.periods],
            "first_date": coverage.index[0].isoformat(), "last_date": coverage.index[-1].isoformat(),
            "years": {str(p.year): st for p, st in year_status.items()},
            "months": {str(p): st for p, st in month_status.items()},
            "partial_dates": _iso(coverage.index[coverage["status"] == "partial"]),
            "trimmed": {"dates": _iso(trimmed_dates), "cell_days": trimmed_cell_days,
                        "note": "Partial WIB dates in a year with no complete date (e.g. 1 Jan after a pull "
                                "ending 31 Dec UTC) are left out of the export; they never count in totals."},
            "note": "A date is covered only when every required source (MODIS_SP, VIIRS_SNPP_SP) covers it. "
                    "Missing dates and months have null values, never 0.",
        },
        "series": {s: {"label": activity.SERIES[s]["label"], "platforms": list(activity.SERIES[s]["platforms"]),
                       "default": s in activity.DEFAULT_SERIES,
                       "platform_periods": _platform_periods(result.platform_seen, activity.SERIES[s]["platforms"],
                                                             last_covered)}
                   for s in SERIES},
        "series_notes": {
            "viirs_all": "Adds NOAA-20 (2018-) and NOAA-21 (2023-); the series jumps when they start. "
                         "Use modis and viirs_snpp for comparisons over time.",
            "platform_periods": "First and last WIB date with a kept detection from each satellite; end is null "
                                "when the satellite was still seen in the final covered month.",
        },
        "sources": [
            {"source": s, "required": s in config.REQUIRED_SOURCES,
             "utc_ranges": [{"start": a.isoformat(), "end": b.isoformat()} for a, b in result.source_ranges.get(s, [])],
             "files": [{"file": r.file, "start": r.start.isoformat(), "end": r.end.isoformat(),
                        "raw_rows": int(r.raw_rows), "kept_rows": int(r.kept_rows)}
                       for r in files_by_source.get(s, pd.DataFrame(columns=result.files.columns)).itertuples(index=False)]}
            for s in (*config.REQUIRED_SOURCES, *config.OPTIONAL_SOURCES)
        ],
        "exclusions": [{"source": r.source, "year": int(r.year), "reason": r.reason, "rows": int(r.rows)}
                       for r in result.exclusions.itertuples(index=False)],
        "boundaries": {"name": meta["name"], "source": meta["source"], "license": meta["license"],
                       "year_represented": meta["year_represented"], "url": meta["url"],
                       "n_provinces": len(provinces),
                       "note": "Province assigned by cell centre; geometries simplified for display."},
        "totals": {
            "indonesia": _sum_totals(indonesia_by_year), "indonesia_by_year": indonesia_by_year,
            "outside_provinces": _sum_totals(outside_by_year), "outside_provinces_by_year": outside_by_year,
            "note": "Complete WIB dates only. Indonesia = sum of provinces. Outside = cells in the FIRMS "
                    "bounding box but in no province (sea, coast, neighbouring countries).",
        },
        "attribution": [
            "Fire detections: NASA FIRMS (MODIS Collection 6.1, VIIRS 375 m), https://firms.modaps.eosdis.nasa.gov/",
            f"Province boundaries: {meta['source']}, {meta['license']}",
        ],
        "provinces": index,
        "files": {"provinces": "provinces.geojson", "monthly": "monthly.json",
                  "schemas": {k: f"schema/{k}.schema.json" for k in SCHEMAS}},
    }


def build_products(result: pipeline.ArchiveResult, provinces: gpd.GeoDataFrame,
                   grid_deg: float = config.HARMONIZATION_GRID_DEG, boundaries_meta: dict | None = None
                   ) -> dict[str, dict]:
    """All documents in one dict (convenient for tests and small ranges)."""
    return dict(iter_products(result, provinces, grid_deg, boundaries_meta))


# ---- Validating and writing ---------------------------------------------------


def validate_products(products: dict[str, dict]) -> None:
    """Validate every document against its JSON Schema and check that every field is typed."""
    for path, doc in products.items():
        kind = kind_of(path)
        try:
            jsonschema.validate(doc, SCHEMAS[kind], format_checker=jsonschema.FormatChecker())
        except jsonschema.ValidationError as err:
            raise ValueError(f"{path} fails the {kind} schema: {err.message}") from err
        if untyped := untyped_fields(doc, SCHEMAS[kind]):
            raise ValueError(f"{path} has fields the {kind} schema does not type: {untyped}")


def write_products(items, out_dir: Path) -> dict[str, dict]:
    """Validate and write ``(path, doc)`` items one at a time, then swap the folder in.

    An existing ``out_dir`` is only replaced if it is empty or a previous export
    (contains ``manifest.json``), so unrelated folders are never deleted. Nothing
    replaces ``out_dir`` unless every item validated and the iterator finished (its own
    invariant checks included); on failure the temporary folder is removed. Returns the
    root-level documents (``manifest.json``, ``provinces.geojson``, ``monthly.json``).
    """
    out_dir = Path(out_dir)
    if out_dir.exists() and any(out_dir.iterdir()) and not (out_dir / "manifest.json").exists():
        raise FileExistsError(f"{out_dir} is not empty and is not a previous export; refusing to replace it")
    tmp = out_dir.with_name(out_dir.name + ".tmp-export")
    shutil.rmtree(tmp, ignore_errors=True)
    summary: dict[str, dict] = {}
    try:
        for rel, doc in items:
            validate_products({rel: doc})
            path = tmp / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(doc, ensure_ascii=False, allow_nan=False, separators=(",", ":")))
            if "/" not in rel:
                summary[rel] = doc
        (tmp / "schema").mkdir(parents=True, exist_ok=True)
        for kind, schema in SCHEMAS.items():
            (tmp / "schema" / f"{kind}.schema.json").write_text(json.dumps(schema, separators=(",", ":")))
    except BaseException:
        shutil.rmtree(tmp, ignore_errors=True)
        raise
    if out_dir.exists():
        shutil.rmtree(out_dir)
    tmp.rename(out_dir)
    return summary


def export_products(out_dir: Path, start: dt.date | None = None, end: dt.date | None = None,
                    boundaries_path: Path | None = None) -> dict:
    """Run the archive pipeline and export validated products. Returns the manifest."""
    result = pipeline.run_archive(start, end)
    items = iter_products(result, regions.load_provinces(boundaries_path))
    return write_products(items, out_dir)["manifest.json"]


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Export Eyes on Karhutla data products from the multi-year archive.")
    parser.add_argument("--out", type=Path, required=True, help="output directory, e.g. ../web/public/data/v1")
    parser.add_argument("--boundaries", type=Path, default=None, help="province GeoJSON (default: config.BOUNDARIES)")
    parser.add_argument("--start", type=dt.date.fromisoformat, default=None, help="first UTC date (default: archive start)")
    parser.add_argument("--end", type=dt.date.fromisoformat, default=None, help="last UTC date (default: archive end)")
    args = parser.parse_args(argv)
    manifest = export_products(args.out, args.start, args.end, args.boundaries)
    print(f"Exported {len(manifest['provinces'])} provinces, years {', '.join(manifest['coverage']['years'])} to {args.out}")
    print(f"Indonesia complete-date totals: {manifest['totals']['indonesia']}; "
          f"outside provinces: {manifest['totals']['outside_provinces']}")


if __name__ == "__main__":
    main()
