"""MODIS–VIIRS harmonization into "active cell-days".

Method (see lode/harmonization/cell-day-method.md):

- Keep only FIRMS ``type == 0`` (presumed vegetation fire). Other types are
  returned in ``excluded`` with an ``exclusion_reason``.
- Derive ``confidence_class`` (low/nominal/high) next to the original
  ``confidence``. The classes are NOT equivalent across sensors.
- Snap each detection centre to a ``grid_deg`` cell (default 0.01°) and to its
  WIB (UTC+7) calendar date, for all of Indonesia.
- Collapse to one row per (cell, WIB date) with per-sensor and per-platform
  (terra/aqua/snpp/noaa20/noaa21) presence flags. Per-platform flags let
  activity series pick a constellation that is consistent over time. Raw
  counts and source record ids are kept for traceability.

On the 2019 sample this gives a common unit but does NOT equalize the sensors:
VIIRS still has ~5.5x the active cell-days of MODIS (sensitivity, not pixel
size). Keep sensor series side by side rather than summing them.

An active cell-day means "at least one thermal anomaly was detected in this
cell on this date". It is not a fire count, burned area, or intensity.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from eyes_on_karhutla import config

CONFIDENCE_CLASSES = ("low", "nominal", "high")
VIIRS_CONFIDENCE = {"l": "low", "n": "nominal", "h": "high"}
# FIRMS MODIS thresholds: low < 30, nominal 30–79, high >= 80 (to be re-confirmed).
MODIS_LOW_BELOW = 30
MODIS_HIGH_FROM = 80


def confidence_class(sensor: pd.Series, confidence: pd.Series) -> pd.Series:
    """Map original FIRMS confidence to low/nominal/high per sensor (NA if unparseable)."""
    out = pd.Series(pd.NA, index=confidence.index, dtype="string")

    modis = sensor == "MODIS"
    pct = pd.to_numeric(confidence.where(modis), errors="coerce")
    out[modis & (pct < MODIS_LOW_BELOW)] = "low"
    out[modis & pct.between(MODIS_LOW_BELOW, MODIS_HIGH_FROM, inclusive="left")] = "nominal"
    out[modis & (pct >= MODIS_HIGH_FROM)] = "high"

    viirs = sensor == "VIIRS"
    out[viirs] = confidence[viirs].astype("string").str.strip().str.lower().map(VIIRS_CONFIDENCE)
    return out


def platform(observations: pd.DataFrame) -> pd.Series:
    """Individual satellite per detection (see ``config.PLATFORMS``); NA if unknown."""
    out = observations["source"].map(config.VIIRS_PLATFORM_BY_SOURCE).astype("string")
    modis = observations["sensor"] == "MODIS"
    if "satellite" in observations.columns:
        out[modis] = observations.loc[modis, "satellite"].map(config.MODIS_PLATFORM_BY_SATELLITE)
    return out


def cell_index(coord: pd.Series, grid_deg: float = config.HARMONIZATION_GRID_DEG) -> pd.Series:
    """Integer grid index ``floor(coord / grid_deg)``, robust to float error (0.29 -> 29)."""
    return np.floor(np.round(coord / grid_deg, 6)).astype("int64")


def wib_date(acq_datetime: pd.Series) -> pd.Series:
    """Calendar date in WIB (UTC+7) for tz-aware UTC timestamps."""
    return acq_datetime.dt.tz_convert(config.HARMONIZATION_TZ).dt.date


def prepare(
    observations: pd.DataFrame,
    grid_deg: float = config.HARMONIZATION_GRID_DEG,
    exclude_low_confidence: bool = False,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Filter and annotate normalized observations; return ``(kept, excluded)``.

    ``exclude_low_confidence`` is a sensitivity option, off by default.
    """
    if "type" not in observations.columns:
        raise ValueError(
            "Observations have no FIRMS 'type' column; cannot apply the type == 0 rule. "
            "Use standard-processing (SP) sources or extend the method for NRT data."
        )
    df = observations.copy()
    df["confidence_class"] = confidence_class(df["sensor"], df["confidence"])
    df["platform"] = platform(df)

    ftype = pd.to_numeric(df["type"], errors="coerce")
    reason = pd.Series(pd.NA, index=df.index, dtype="string")
    if exclude_low_confidence:
        reason[df["confidence_class"] == "low"] = "low_confidence"
    reason[df["platform"].isna()] = "unknown_platform"
    reason[ftype.notna() & (ftype != 0)] = "non_vegetation_type"
    reason[ftype.isna()] = "missing_type"

    excluded = df[reason.notna()].assign(exclusion_reason=reason[reason.notna()])
    kept = df[reason.isna()].copy()
    kept["cell_i"] = cell_index(kept["latitude"], grid_deg)
    kept["cell_j"] = cell_index(kept["longitude"], grid_deg)
    kept["wib_date"] = wib_date(kept["acq_datetime"])
    return kept.reset_index(drop=True), excluded.reset_index(drop=True)


def to_cell_days(
    kept: pd.DataFrame,
    grid_deg: float = config.HARMONIZATION_GRID_DEG,
    keep_record_ids: bool = True,
) -> pd.DataFrame:
    """Collapse prepared detections to one row per (cell, WIB date).

    ``keep_record_ids=False`` drops the ``source_record_ids`` lists to save memory on
    multi-year runs; traceability then rests on the immutable raw archive files.
    """
    platform_hits = [f"{p}_hit" for p in config.PLATFORMS]
    columns = [
        "cell_lat", "cell_lon", "wib_date", "modis_hit", "viirs_hit", *platform_hits,
        "n_modis", "n_viirs", "low_conf_only", *(["source_record_ids"] if keep_record_ids else []),
    ]
    if kept.empty:
        return pd.DataFrame(columns=columns)

    df = kept.assign(
        _modis=kept["sensor"] == "MODIS",
        _viirs=kept["sensor"] == "VIIRS",
        # Unknown confidence counts as "not low", so it never produces a low-only flag.
        _low=(kept["confidence_class"] == "low").fillna(False).astype(bool),
        **{f"_{p}": kept["platform"] == p for p in config.PLATFORMS},
    )
    out = df.groupby(["cell_i", "cell_j", "wib_date"], sort=True).agg(
        **{f"{p}_hit": (f"_{p}", "any") for p in config.PLATFORMS},
        n_modis=("_modis", "sum"),
        n_viirs=("_viirs", "sum"),
        low_conf_only=("_low", "all"),
        **({"source_record_ids": ("source_record_id", list)} if keep_record_ids else {}),
    ).reset_index()
    out["modis_hit"] = out["n_modis"] > 0
    out["viirs_hit"] = out["n_viirs"] > 0
    out["cell_lat"] = (out["cell_i"] * grid_deg).round(6)
    out["cell_lon"] = (out["cell_j"] * grid_deg).round(6)
    return out[columns]


CELL_DAY_KEYS = ["cell_lat", "cell_lon", "wib_date"]


def merge_cell_days(frames: list[pd.DataFrame]) -> pd.DataFrame:
    """Combine cell-day frames built from separate chunks (e.g. UTC years).

    A detection after 17:00 UTC on 31 Dec falls on 1 Jan WIB, so the same (cell, WIB date)
    can come out of two chunks. Those rows are merged: hit flags OR, counts sum,
    ``low_conf_only`` AND, record id lists concatenate. Other rows pass through unchanged.
    """
    frames = [f for f in frames if not f.empty]
    if not frames:
        return to_cell_days(pd.DataFrame())
    df = pd.concat(frames, ignore_index=True)
    dup = df.duplicated(CELL_DAY_KEYS, keep=False)
    if dup.any():
        hits = [c for c in df.columns if c.endswith("_hit")]
        agg = {**{c: "any" for c in hits}, "n_modis": "sum", "n_viirs": "sum", "low_conf_only": "all"}
        if "source_record_ids" in df.columns:
            agg["source_record_ids"] = lambda ids: [i for chunk in ids for i in chunk]
        merged = df[dup].groupby(CELL_DAY_KEYS, sort=False).agg(agg).reset_index()
        df = pd.concat([df[~dup], merged[df.columns]], ignore_index=True)
    return df.sort_values(CELL_DAY_KEYS, ignore_index=True)


def harmonize(
    observations: pd.DataFrame,
    grid_deg: float = config.HARMONIZATION_GRID_DEG,
    exclude_low_confidence: bool = False,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Normalized MODIS + VIIRS observations -> ``(cell_days, excluded)``."""
    kept, excluded = prepare(observations, grid_deg, exclude_low_confidence)
    return to_cell_days(kept, grid_deg), excluded
