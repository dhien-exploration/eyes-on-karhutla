"""End-to-end orchestration shared by notebooks and the Streamlit app.

raw FIRMS CSVs -> normalize -> harmonize (cell-days) -> daily activity series.
No new science here; it only chains the modules and checks their invariants.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd

from eyes_on_karhutla import activity, archive, config, harmonization, ingestion, preprocessing

SP_SOURCES = ("MODIS_SP", "VIIRS_SNPP_SP", "VIIRS_NOAA20_SP")


@dataclass
class Result:
    cell_days: pd.DataFrame
    daily: pd.DataFrame
    excluded: pd.DataFrame          # preprocessing + harmonization exclusions, with reasons
    utc_start: dt.date
    utc_end: dt.date
    provenance: pd.DataFrame        # one row per source: file, pull range, row counts
    exclude_low_confidence: bool = False
    notes: list[str] = field(default_factory=list)


def run_local(
    sources: tuple[str, ...] = SP_SOURCES,
    exclude_low_confidence: bool = False,
) -> Result:
    """Run the pipeline on the latest raw file per source in ``data/raw/``.

    All sources must share one UTC pull range, so that series are comparable.
    """
    paths = {s: ingestion.latest_raw(s) for s in sources}
    ranges = {s: ingestion.pull_range(p) for s, p in paths.items()}
    if len(set(ranges.values())) != 1:
        raise ValueError(f"Sources have different pull ranges: {ranges}")
    utc_start, utc_end = next(iter(ranges.values()))

    raw = pd.concat([ingestion.read_firms_csv(p, s) for s, p in paths.items()], ignore_index=True)
    obs, norm_excluded = preprocessing.normalize(raw)
    kept, harm_excluded = harmonization.prepare(obs, exclude_low_confidence=exclude_low_confidence)
    cell_days = harmonization.to_cell_days(kept)
    excluded = pd.concat([norm_excluded, harm_excluded], ignore_index=True)
    assert len(kept) + len(excluded) == len(raw)

    provenance = pd.DataFrame({
        "source": list(paths),
        "file": [p.name for p in paths.values()],
        "utc_start": utc_start,
        "utc_end": utc_end,
        "raw_rows": raw.groupby("source").size().reindex(list(paths), fill_value=0).to_numpy(),
        "kept_rows": kept.groupby("source").size().reindex(list(paths), fill_value=0).to_numpy(),
    })
    daily = activity.daily_series(cell_days, utc_start, utc_end, series=tuple(activity.SERIES))
    return Result(cell_days, daily, excluded, utc_start, utc_end, provenance, exclude_low_confidence)


# ---- Multi-year archive (export v1) --------------------------------------------------------


@dataclass
class ArchiveResult:
    cell_days: pd.DataFrame         # merged across UTC years; no source_record_ids
    periods: list                   # covered UTC periods [(start, end)], gaps allowed
    coverage: pd.DataFrame          # activity.coverage_status(periods)
    source_ranges: dict             # source -> merged UTC ranges present locally
    files: pd.DataFrame             # source, file, start, end, raw_rows, kept_rows
    exclusions: pd.DataFrame        # source, year, reason, rows
    platform_seen: dict             # platform -> (first, last) WIB date of a kept detection


def _clip(periods, start, end):
    lo, hi = start or dt.date.min, end or dt.date.max
    return [(max(s, lo), min(e, hi)) for s, e in periods if max(s, lo) <= min(e, hi)]


def run_archive(start: dt.date | None = None, end: dt.date | None = None,
                required: tuple[str, ...] = config.REQUIRED_SOURCES,
                optional: tuple[str, ...] = config.OPTIONAL_SOURCES,
                root: Path | None = None) -> ArchiveResult:
    """Process the local archive one UTC year at a time and merge the cell-days.

    Detections on UTC dates outside the covered periods are excluded with reason
    ``outside_coverage``. ``start``/``end`` (UTC, inclusive) narrow the periods.
    """
    cov = archive.coverage(required, optional, root)
    periods = _clip(cov["periods"], start, end)
    if not periods:
        raise ValueError(f"No covered periods in the archive for {start} → {end}; run `archive pull` first")
    sources = (*required, *optional)
    listing = {s: archive.list_files(s, root) for s in sources}
    covered = pd.Series(True, index=pd.Index([d for s, e in periods for d in pd.date_range(s, e).date]))

    frames, file_rows, exclusions = [], [], []
    seen: dict[str, list] = {}
    for year in range(periods[0][0].year, periods[-1][1].year + 1):
        files = [(s, r) for s in sources for r in listing[s].itertuples(index=False) if r.start.year == year]
        if not files:
            continue
        raw = pd.concat([ingestion.read_firms_csv(r.path, s) for s, r in files], ignore_index=True)
        obs, norm_excluded = preprocessing.normalize(raw)
        in_cov = obs["acq_datetime"].dt.date.map(covered).fillna(False).astype(bool)
        outside = obs[~in_cov].assign(exclusion_reason="outside_coverage")
        kept, harm_excluded = harmonization.prepare(obs[in_cov])
        frames.append(harmonization.to_cell_days(kept, keep_record_ids=False))
        excluded = pd.concat([norm_excluded, outside, harm_excluded], ignore_index=True)
        assert len(kept) + len(excluded) == len(raw)
        if len(excluded):
            counts = excluded.groupby(["source", "exclusion_reason"]).size()
            exclusions += [{"source": s, "year": year, "reason": r, "rows": int(n)} for (s, r), n in counts.items()]
        # read_firms_csv stores the file path in source_ref, so rows are counted per file.
        raw_by_file = raw.groupby("source_ref").size()
        kept_by_file = kept.groupby("source_ref").size()
        for s, r in files:
            file_rows.append({"source": s, "file": f"{s.lower()}/{r.path.name}", "start": r.start, "end": r.end,
                              "raw_rows": int(raw_by_file.get(str(r.path), 0)),
                              "kept_rows": int(kept_by_file.get(str(r.path), 0))})
        for platform, dates in kept.groupby("platform")["wib_date"]:
            seen.setdefault(platform, []).extend([dates.min(), dates.max()])

    cell_days = harmonization.merge_cell_days(frames)
    return ArchiveResult(
        cell_days=cell_days,
        periods=periods,
        coverage=activity.coverage_status(periods),
        source_ranges=cov["sources"],
        files=pd.DataFrame(file_rows, columns=["source", "file", "start", "end", "raw_rows", "kept_rows"]),
        exclusions=pd.DataFrame(exclusions, columns=["source", "year", "reason", "rows"]),
        platform_seen={p: (min(d), max(d)) for p, d in seen.items()},
    )
