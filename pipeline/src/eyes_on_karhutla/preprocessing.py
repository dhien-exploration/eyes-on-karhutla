"""Normalize raw FIRMS rows into the internal observation schema.

Normalized schema (see lode/data/observation-schema.md):

    latitude, longitude   float, WGS84 degrees
    acq_datetime          tz-aware UTC timestamp (from acq_date + acq_time HHMM)
    sensor                "MODIS" | "VIIRS"
    satellite             original FIRMS satellite value, unchanged
    confidence            original FIRMS confidence, as string (MODIS 0-100, VIIRS l/n/h)
    frp                   fire radiative power, MW (nullable)
    scan, track           pixel size along scan/track, km (nullable)
    daynight              "D" | "N" (nullable)
    source                FIRMS source name, e.g. "MODIS_SP"
    source_record_id      deterministic id derived from source + core fields
    source_ref, retrieved_at  provenance from ingestion

All other original columns are kept as-is. Rows failing validation are returned
separately with an ``exclusion_reason`` rather than dropped silently.
"""

from __future__ import annotations

import hashlib

import pandas as pd

from eyes_on_karhutla import config

REQUIRED_COLUMNS = ("latitude", "longitude", "acq_date", "acq_time", "source")


def _record_id(row: pd.Series) -> str:
    key = f"{row['source']}|{row['latitude']}|{row['longitude']}|{row['acq_date']}|{row['acq_time']}|{row.get('satellite', '')}"
    return hashlib.sha1(key.encode()).hexdigest()[:16]


def parse_acq_datetime(acq_date: pd.Series, acq_time: pd.Series) -> pd.Series:
    """Combine FIRMS ``acq_date`` (YYYY-MM-DD) and ``acq_time`` (HHMM, UTC) into UTC timestamps.

    ``acq_time`` may arrive without leading zeros (e.g. ``5`` meaning 00:05).
    """
    hhmm = acq_time.astype(str).str.strip().str.split(".").str[0].str.zfill(4)
    return pd.to_datetime(
        acq_date.astype(str) + " " + hhmm, format="%Y-%m-%d %H%M", errors="coerce", utc=True
    )


def normalize(raw: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Return ``(observations, excluded)`` for a raw FIRMS frame from ingestion."""
    missing = [c for c in REQUIRED_COLUMNS if c not in raw.columns]
    if missing:
        raise ValueError(f"Raw frame is missing required columns: {missing}")

    df = raw.copy()
    df["latitude"] = pd.to_numeric(df["latitude"], errors="coerce")
    df["longitude"] = pd.to_numeric(df["longitude"], errors="coerce")
    df["acq_datetime"] = parse_acq_datetime(df["acq_date"], df["acq_time"])
    df["sensor"] = df["source"].map(config.FIRMS_SOURCES)
    if "confidence" in df.columns:
        df["confidence"] = df["confidence"].astype("string").str.strip()
    for col in ("frp", "scan", "track"):
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    reason = pd.Series(pd.NA, index=df.index, dtype="string")
    reason[df["sensor"].isna()] = "unknown_source"
    reason[df["acq_datetime"].isna()] = "invalid_acq_datetime"
    bad_coord = (
        df["latitude"].isna()
        | df["longitude"].isna()
        | ~df["latitude"].between(-90, 90)
        | ~df["longitude"].between(-180, 180)
    )
    reason[bad_coord] = "invalid_coordinates"

    excluded = df[reason.notna()].assign(exclusion_reason=reason[reason.notna()])
    obs = df[reason.isna()].copy()
    obs["source_record_id"] = obs.apply(_record_id, axis=1) if len(obs) else pd.Series(dtype=str)
    return obs.reset_index(drop=True), excluded.reset_index(drop=True)
