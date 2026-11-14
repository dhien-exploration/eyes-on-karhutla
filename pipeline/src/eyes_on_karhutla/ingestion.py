"""Load NASA FIRMS hotspot data (API or local CSV) while preserving provenance.

Every loaded frame keeps the original FIRMS columns untouched and adds:
  - ``source``       FIRMS source name, e.g. ``VIIRS_SNPP_SP``
  - ``source_ref``   where the rows came from (file path or API URL with the key redacted)
  - ``retrieved_at`` UTC timestamp of loading
"""

from __future__ import annotations

import io
import re
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import requests

from eyes_on_karhutla import config

BBox = tuple[float, float, float, float]


def build_area_url(
    source: str,
    bbox: BBox,
    day_range: int,
    start: date | None = None,
    map_key: str | None = None,
) -> str:
    """Build a FIRMS area CSV API URL.

    ``start`` is the first day of the window; FIRMS returns ``day_range`` days from it.
    """
    if source not in config.FIRMS_SOURCES:
        raise ValueError(f"Unsupported FIRMS source: {source!r}")
    if not 1 <= day_range <= config.FIRMS_MAX_DAY_RANGE:
        raise ValueError(f"day_range must be 1..{config.FIRMS_MAX_DAY_RANGE}, got {day_range}")
    key = map_key if map_key is not None else config.firms_map_key()
    area = ",".join(f"{v:g}" for v in bbox)
    url = f"{config.FIRMS_BASE_URL}/api/area/csv/{key}/{source}/{area}/{day_range}"
    if start is not None:
        url += f"/{start.isoformat()}"
    return url


def redact_key(url: str, map_key: str) -> str:
    """Remove the MAP_KEY from a URL before storing it as provenance."""
    return url.replace(map_key, "<MAP_KEY>") if map_key else url


RETRY_BACKOFF_S = (5, 15, 45, 120, 300)   # ~8 min total; waits between attempts for 5xx / 429 / network errors
# FIRMS answers "Exceeding allowed transaction limit." (HTTP 400 on /api/area, 403 on
# /api/data_availability) when the MAP_KEY's budget
# (5000 transactions per 10 minutes) is spent. One 5-day Indonesia area request costs ~11
# transactions, so long pulls hit this; wait for the window to roll instead of failing.
RATE_LIMIT_TEXT = "transaction limit"
RATE_LIMIT_WAIT_S = 60
RATE_LIMIT_MAX_WAITS = 15       # > one 10-minute window


def _get(http, url: str, key: str, timeout: float):
    """GET with retries on transient failures. Errors never contain the MAP_KEY.

    requests puts the full URL (with the key) into its exception messages, so every
    failure is re-raised as RuntimeError with the redacted URL and no chained cause.
    """
    safe = redact_key(url, key)
    problem = ""
    attempt = waits = 0
    while True:
        try:
            resp = http.get(url, timeout=timeout)
        except requests.RequestException as err:
            problem = type(err).__name__
        else:
            status = getattr(resp, "status_code", 200)
            if status >= 400 and RATE_LIMIT_TEXT in (resp.text or "").lower():
                waits += 1
                if waits > RATE_LIMIT_MAX_WAITS:
                    raise RuntimeError(f"FIRMS transaction limit still exceeded after {waits - 1} waits for {safe}") from None
                time.sleep(RATE_LIMIT_WAIT_S)
                continue
            if status < 500 and status != 429:
                if status >= 400:
                    raise RuntimeError(f"FIRMS HTTP {status} for {safe}") from None
                return resp
            problem = f"HTTP {status}"
        if attempt >= len(RETRY_BACKOFF_S):
            break
        time.sleep(RETRY_BACKOFF_S[attempt])
        attempt += 1
    raise RuntimeError(f"FIRMS request failed after {len(RETRY_BACKOFF_S) + 1} attempts ({problem}) for {safe}") from None


def _add_provenance(df: pd.DataFrame, source: str, source_ref: str) -> pd.DataFrame:
    df = df.copy()
    df["source"] = source
    df["source_ref"] = source_ref
    df["retrieved_at"] = pd.Timestamp.now(tz=timezone.utc)
    return df


def read_firms_csv(path: str | Path, source: str) -> pd.DataFrame:
    """Read a FIRMS CSV file (API response or archive download) for one source."""
    if source not in config.FIRMS_SOURCES:
        raise ValueError(f"Unsupported FIRMS source: {source!r}")
    path = Path(path)
    df = pd.read_csv(path, dtype={"acq_time": str, "confidence": str})
    return _add_provenance(df, source, str(path))


def fetch_area(
    source: str,
    bbox: BBox,
    start: date,
    end: date,
    map_key: str | None = None,
    session: requests.Session | None = None,
    timeout: float = 120,
    cache_dir: Path | None = None,
    on_window=None,
) -> pd.DataFrame:
    """Fetch FIRMS detections for ``[start, end]`` (inclusive), chunked into API-sized windows.

    Returns an empty frame (with provenance columns) when FIRMS reports no detections.
    With ``cache_dir``, each window's raw CSV is saved there as it arrives and reused on a
    later call, so an interrupted long pull resumes instead of starting over.
    ``on_window(done, total)`` is called after each window (progress reporting).
    """
    if end < start:
        raise ValueError("end must not be before start")
    key = map_key if map_key is not None else config.firms_map_key()
    http = session or requests.Session()
    frames: list[pd.DataFrame] = []
    total = -(-((end - start).days + 1) // config.FIRMS_MAX_DAY_RANGE)
    cursor = start
    while cursor <= end:
        days = min(config.FIRMS_MAX_DAY_RANGE, (end - cursor).days + 1)
        url = build_area_url(source, bbox, days, cursor, key)
        cached = cache_dir / f"{cursor.isoformat()}_{days}.csv" if cache_dir else None
        if cached is not None and cached.exists():
            text = cached.read_text()
        else:
            text = _get(http, url, key, timeout).text
        # FIRMS returns plain-text errors (e.g. invalid key) with HTTP 200.
        if not text.startswith("latitude"):
            raise RuntimeError(f"Unexpected FIRMS response for {redact_key(url, key)}: {text[:200]!r}")
        if cached is not None and not cached.exists():
            cached.parent.mkdir(parents=True, exist_ok=True)
            tmp = cached.with_suffix(".tmp")
            tmp.write_text(text)
            tmp.rename(cached)
        chunk = pd.read_csv(io.StringIO(text), dtype={"acq_time": str, "confidence": str})
        frames.append(_add_provenance(chunk, source, redact_key(url, key)))
        cursor += timedelta(days=days)
        if on_window:
            on_window(len(frames), total)
    return pd.concat(frames, ignore_index=True)


def data_availability(map_key: str | None = None, session: requests.Session | None = None,
                      timeout: float = 60) -> pd.DataFrame:
    """Per-source date coverage from FIRMS ``/api/data_availability/``: ``source, min_date, max_date``."""
    key = map_key if map_key is not None else config.firms_map_key()
    url = f"{config.FIRMS_BASE_URL}/api/data_availability/csv/{key}/all"
    resp = _get(session or requests.Session(), url, key, timeout)
    if not resp.text.startswith("data_id"):
        raise RuntimeError(f"Unexpected FIRMS response for {redact_key(url, key)}: {resp.text[:200]!r}")
    df = pd.read_csv(io.StringIO(resp.text))
    return pd.DataFrame({
        "source": df["data_id"],
        "min_date": pd.to_datetime(df["min_date"]).dt.date,
        "max_date": pd.to_datetime(df["max_date"]).dt.date,
    })


def latest_raw(source: str, raw_dir: Path | None = None) -> Path:
    """Return the most recently saved raw file for ``source`` (files from ``save_raw``)."""
    raw_dir = raw_dir or config.RAW_DIR
    matches = sorted(raw_dir.glob(f"{source.lower()}_*.csv"))
    if not matches:
        raise FileNotFoundError(f"No raw file for {source} in {raw_dir}")
    return matches[-1]  # names end with a UTC timestamp, so lexical order == time order


RAW_NAME = re.compile(r"^(?P<source>.+)_(?P<start>\d{4}-\d{2}-\d{2})_(?P<end>\d{4}-\d{2}-\d{2})_\d{8}T\d{6}Z\.csv$")


def pull_range(path: str | Path) -> tuple[date, date]:
    """UTC date range ``(start, end)`` of a raw pull, from its file name.

    Relies on the naming convention ``{source}_{start}_{end}_{stamp}.csv`` used for
    ``save_raw(df, f"{source.lower()}_{start}_{end}")``. The range is the requested
    pull window, which can include days without detections.
    """
    m = RAW_NAME.match(Path(path).name)
    if not m:
        raise ValueError(f"Raw file name does not encode a pull range: {Path(path).name}")
    return date.fromisoformat(m["start"]), date.fromisoformat(m["end"])


def save_raw(df: pd.DataFrame, name: str) -> Path:
    """Write a raw pull to ``data/raw/`` unchanged, for reproducibility."""
    config.RAW_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = config.RAW_DIR / f"{name}_{stamp}.csv"
    df.to_csv(path, index=False)
    return path
