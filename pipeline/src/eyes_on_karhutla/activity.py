"""Aggregate harmonized cell-days into side-by-side activity series.

The metric is **active cell-days**: the number of 0.01° cells with at least
one kept detection on a WIB date, per sensor series (see
lode/activity/summary.md). It is not a fire count, burned area or FRP.

MODIS and VIIRS series are kept side by side and never summed: VIIRS detects
~5.5x more active cell-days than MODIS because it is more sensitive. Each
series is defined by a fixed set of platforms, so it stays comparable over time:
``viirs_snpp`` is S-NPP only (2012–); ``viirs_all`` adds NOAA-20 (2018–) and
NOAA-21, and therefore jumps when those satellites start.
"""

from __future__ import annotations

import datetime as dt

import pandas as pd

SERIES = {
    "modis": {"label": "MODIS (Terra + Aqua)", "platforms": ("terra", "aqua")},
    "viirs_snpp": {"label": "VIIRS S-NPP", "platforms": ("snpp",)},
    "viirs_all": {"label": "VIIRS all satellites", "platforms": ("snpp", "noaa20", "noaa21")},
}
# The pair with a constant constellation since 2012 (Aqua joined MODIS in 2002).
DEFAULT_SERIES = ("modis", "viirs_snpp")


def wib_date_coverage(utc_start: dt.date, utc_end: dt.date) -> pd.DataFrame:
    """WIB dates touched by a pull of UTC dates ``utc_start..utc_end`` (inclusive).

    A WIB date D spans UTC D-1 17:00 to D 17:00, so only ``utc_start + 1 .. utc_end``
    are complete; ``utc_start`` lacks 00:00–07:00 WIB and ``utc_end + 1`` has only that.
    """
    dates = pd.date_range(utc_start, utc_end + dt.timedelta(days=1), freq="D").date
    complete = (dates > utc_start) & (dates <= utc_end)
    return pd.DataFrame({"complete": complete}, index=pd.Index(dates, name="wib_date"))


def daily_series(
    cell_days: pd.DataFrame,
    utc_start: dt.date,
    utc_end: dt.date,
    series: tuple[str, ...] = DEFAULT_SERIES,
) -> pd.DataFrame:
    """Active cell-days per WIB date and series, zero-filled, with a ``complete`` flag."""
    out = wib_date_coverage(utc_start, utc_end)
    hits = series_hits(cell_days, series)
    for name in series:
        counts = hits[name].groupby(cell_days["wib_date"]).sum()
        out[name] = counts.reindex(out.index, fill_value=0).astype("int64")
    return out


def series_hits(cell_days: pd.DataFrame, series: tuple[str, ...] = tuple(SERIES)) -> pd.DataFrame:
    """Per cell-day: whether each series (its fixed platform set) detected it."""
    return pd.DataFrame(
        {name: cell_days[[f"{p}_hit" for p in SERIES[name]["platforms"]]].any(axis=1) for name in series},
        index=cell_days.index,
    )


def aggregate(daily: pd.DataFrame, freq: str) -> pd.DataFrame:
    """Sum complete days into periods (pandas period alias, e.g. ``"W"``, ``"M"``, ``"Y"``).

    Partial WIB dates are left out. ``n_complete_days`` vs ``n_days`` shows how much
    of each period is covered, so partial periods are not mistaken for quiet ones.
    """
    series = [c for c in daily.columns if c in SERIES]
    periods = pd.PeriodIndex(pd.to_datetime(daily.index), freq=freq)
    grouped = daily[daily["complete"]].groupby(periods[daily["complete"].to_numpy()])
    out = grouped[series].sum()
    out["n_complete_days"] = grouped.size()
    out["n_days"] = [(p.end_time - p.start_time).days + 1 for p in out.index]
    out.index.name = "period"
    return out


def series_ratio(daily: pd.DataFrame, numerator: str, denominator: str) -> pd.Series:
    """Daily ``numerator / denominator`` on complete dates (NaN where the denominator is 0)."""
    d = daily[daily["complete"]]
    return (d[numerator] / d[denominator].where(d[denominator] > 0)).rename(f"{numerator}_over_{denominator}")


def sensor_agreement(cell_days: pd.DataFrame, a: str = "modis", b: str = "viirs_snpp") -> pd.Series:
    """Per cell-day: ``both``, ``a_only``, ``b_only`` or NA (neither series hit it).

    Same-cell agreement at 0.01° undercounts matches: one fire often lands in
    neighbouring cells (MODIS vs all VIIRS, 2019: 57% same cell vs 85% within 3x3).
    """
    hits = series_hits(cell_days, (a, b))
    hit_a, hit_b = hits[a], hits[b]
    out = pd.Series(pd.NA, index=cell_days.index, dtype="string")
    out[hit_a & hit_b] = "both"
    out[hit_a & ~hit_b] = "a_only"
    out[~hit_a & hit_b] = "b_only"
    return out


# ---- Multi-year (export v1): every date / period carries a coverage status ------------------

STATUSES = ("complete", "partial", "missing")


def coverage_status(periods: list[tuple[dt.date, dt.date]]) -> pd.DataFrame:
    """Status of every WIB date from the first to the last date touched by UTC ``periods``.

    Each inclusive UTC period behaves like ``wib_date_coverage``: its first WIB date and the
    day after its end are ``partial``. Dates between periods are ``missing``. Periods must
    be merged first (non-adjacent), e.g. by ``archive.merge_ranges``.
    """
    if not periods:
        raise ValueError("No covered periods")
    first, last = periods[0][0], periods[-1][1] + dt.timedelta(days=1)
    out = pd.DataFrame({"status": "missing"}, index=pd.Index(pd.date_range(first, last).date, name="wib_date"))
    for start, end in periods:
        cov = wib_date_coverage(start, end)
        out.loc[cov.index, "status"] = cov["complete"].map({True: "complete", False: "partial"}).to_numpy()
    return out


def daily_with_status(cell_days: pd.DataFrame, coverage: pd.DataFrame,
                      series: tuple[str, ...] = tuple(SERIES)) -> pd.DataFrame:
    """Active cell-days per WIB date and series, with ``status``; values are NA on missing dates.

    Partial dates keep their (incomplete) counts; period sums use complete dates only.
    """
    out = coverage[["status"]].copy()
    hits = series_hits(cell_days, series)
    for name in series:
        counts = hits[name].groupby(cell_days["wib_date"]).sum()
        values = counts.reindex(out.index, fill_value=0).astype("Int64")
        out[name] = values.mask(out["status"] == "missing")
    return out


def period_series(daily: pd.DataFrame, freq: str) -> pd.DataFrame:
    """Months (``"M"``) or years (``"Y"``) from ``daily_with_status``.

    Status: ``complete`` if every day is complete, ``missing`` if no day is covered,
    else ``partial``. Values sum complete days only and are NA when missing.
    """
    series = [c for c in daily.columns if c in SERIES]
    periods = pd.PeriodIndex(pd.to_datetime(daily.index), freq=freq)
    status = daily["status"].groupby(periods).agg(
        lambda s: "complete" if (s == "complete").all() else "missing" if (s == "missing").all() else "partial"
    )
    complete = daily["status"] == "complete"
    sums = daily.loc[complete, series].groupby(periods[complete.to_numpy()]).sum()
    out = sums.reindex(status.index, fill_value=0).astype("Int64")
    out = out.mask(status == "missing", other=pd.NA)
    out.insert(0, "status", status)
    out.index.name = "period"
    return out
