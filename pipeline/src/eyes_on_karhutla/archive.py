"""Multi-year raw FIRMS archive: layout, pull planning, coverage.

Layout (lode/export/multi-year-archive.md):

    data/raw/firms/{source_lower}/{start}_{end}.csv

One file per source per UTC calendar year, named by its inclusive UTC pull range.
Files are written once and never edited, so they are the provenance for every
derived number. Coverage is defined by the required sources: a UTC date is
covered only if every required source covers it.

    uv run python -m eyes_on_karhutla.archive status
    uv run python -m eyes_on_karhutla.archive pull --start 2019-01-01 --end 2020-12-31
"""

from __future__ import annotations

import argparse
import datetime as dt
import re
import shutil
from dataclasses import dataclass
from pathlib import Path

import pandas as pd
import requests

from eyes_on_karhutla import config, ingestion

FILE_NAME = re.compile(r"^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})\.csv$")
Range = tuple[dt.date, dt.date]


@dataclass(frozen=True)
class PullTask:
    source: str
    start: dt.date
    end: dt.date
    path: Path
    replaces: Path | None = None


def source_dir(source: str, root: Path | None = None) -> Path:
    return (root or config.ARCHIVE_DIR) / source.lower()


def file_path(source: str, start: dt.date, end: dt.date, root: Path | None = None) -> Path:
    return source_dir(source, root) / f"{start.isoformat()}_{end.isoformat()}.csv"


def parts_dir(path: Path) -> Path:
    """Hidden window cache for an archive file being pulled (removed after success)."""
    return path.parent / f".{path.stem}.parts"


def list_files(source: str, root: Path | None = None) -> pd.DataFrame:
    """Archive files of one source as ``path, start, end``, sorted. Raises on bad names or overlaps."""
    rows = []
    folder = source_dir(source, root)
    for path in sorted(folder.glob("*.csv")) if folder.exists() else []:
        m = FILE_NAME.match(path.name)
        if not m:
            raise ValueError(f"Unexpected file in the archive: {path}")
        start, end = dt.date.fromisoformat(m[1]), dt.date.fromisoformat(m[2])
        if end < start or start.year != end.year:
            raise ValueError(f"Archive file must cover one UTC year, start <= end: {path}")
        rows.append({"path": path, "start": start, "end": end})
    df = pd.DataFrame(rows, columns=["path", "start", "end"]).sort_values("start", ignore_index=True)
    for prev, nxt in zip(df.itertuples(), df.iloc[1:].itertuples()):
        if nxt.start <= prev.end:
            raise ValueError(f"Overlapping archive files: {prev.path.name} and {nxt.path.name} ({source})")
    return df


def merge_ranges(ranges: list[Range]) -> list[Range]:
    """Union of inclusive date ranges; adjacent ranges (end + 1 day = start) are joined."""
    merged: list[Range] = []
    for start, end in sorted(ranges):
        if merged and start <= merged[-1][1] + dt.timedelta(days=1):
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def intersect_ranges(a: list[Range], b: list[Range]) -> list[Range]:
    out = [(max(s1, s2), min(e1, e2)) for s1, e1 in a for s2, e2 in b if max(s1, s2) <= min(e1, e2)]
    return merge_ranges(out)


def coverage(required: tuple[str, ...] = config.REQUIRED_SOURCES,
             optional: tuple[str, ...] = config.OPTIONAL_SOURCES,
             root: Path | None = None) -> dict:
    """Per-source UTC ranges and the covered ``periods`` (intersection of required sources)."""
    ranges = {s: merge_ranges(list(zip(f["start"], f["end"])))
              for s in (*required, *optional) for f in [list_files(s, root)]}
    periods = ranges[required[0]] if required else []
    for s in required[1:]:
        periods = intersect_ranges(periods, ranges[s])
    return {"sources": ranges, "periods": periods}


def default_end(availability: pd.DataFrame, required: tuple[str, ...] = config.REQUIRED_SOURCES) -> dt.date:
    """Latest date every required source has in the FIRMS archive (keeps series comparable)."""
    avail = availability.set_index("source")
    missing = [s for s in required if s not in avail.index]
    if missing:
        raise ValueError(f"FIRMS availability lists no {missing}")
    return min(avail.loc[list(required), "max_date"])


def plan_pull(sources: tuple[str, ...], start: dt.date, end: dt.date, availability: pd.DataFrame,
              root: Path | None = None) -> list[PullTask]:
    """Tasks to fetch, one per source and UTC year (pure apart from listing existing files).

    Each year's window is clamped to the request and to FIRMS availability, then widened to
    any existing file of that year, so a smaller (partial) file is replaced rather than
    overlapped. Years already covered by a file are skipped.
    """
    avail = availability.set_index("source")
    tasks: list[PullTask] = []
    for source in sources:
        if source not in avail.index:
            raise ValueError(f"FIRMS availability lists no {source}")
        lo, hi = max(start, avail.at[source, "min_date"]), min(end, avail.at[source, "max_date"])
        existing = list_files(source, root)
        for year in range(lo.year, hi.year + 1) if lo <= hi else []:
            ws, we = max(lo, dt.date(year, 1, 1)), min(hi, dt.date(year, 12, 31))
            same_year = existing[existing["start"].map(lambda s: s.year == year).astype(bool)]
            if any((same_year["start"] <= ws) & (same_year["end"] >= we)):
                continue
            if len(same_year) > 1:
                raise ValueError(f"{source} {year}: several partial files; merge or remove them first")
            replaces = None
            if len(same_year) == 1:
                old = same_year.iloc[0]
                ws, we, replaces = min(ws, old["start"]), max(we, old["end"]), old["path"]
            tasks.append(PullTask(source, ws, we, file_path(source, ws, we, root), replaces))
    return tasks


def pull(tasks: list[PullTask], map_key: str | None = None, session: requests.Session | None = None,
         log=print) -> list[Path]:
    """Fetch each task from the FIRMS area API and write it; a replaced file is removed after.

    Windows are cached in a hidden ``.{name}.parts/`` folder next to the target, so rerunning
    after an interruption resumes where it stopped. The cache is removed once the file is written.
    """
    written = []
    for i, task in enumerate(tasks, 1):
        log(f"[{i}/{len(tasks)}] {task.source} {task.start} → {task.end}")
        parts = parts_dir(task.path)

        def progress(done, total):
            if done % 10 == 0 or done == total:
                log(f"    {done}/{total} windows")

        df = ingestion.fetch_area(task.source, config.INDONESIA_BBOX, task.start, task.end, map_key, session,
                                  cache_dir=parts, on_window=progress)
        task.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = task.path.with_suffix(".csv.part")
        df.to_csv(tmp, index=False)
        tmp.rename(task.path)
        shutil.rmtree(parts, ignore_errors=True)
        if task.replaces is not None and task.replaces != task.path:
            task.replaces.unlink()
        log(f"    {len(df):,} rows -> {task.path}")
        written.append(task.path)
    return written


def _fmt(ranges: list[Range]) -> str:
    return ", ".join(f"{s} → {e}" for s, e in ranges) or "none"


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Manage the local multi-year FIRMS archive.")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status", help="FIRMS availability vs. local archive files")
    p = sub.add_parser("pull", help="fetch missing years into data/raw/firms/")
    p.add_argument("--start", type=dt.date.fromisoformat, required=True, help="UTC date, inclusive")
    p.add_argument("--end", type=dt.date.fromisoformat, default=None,
                   help="UTC date, inclusive (default: latest date all required sources have)")
    p.add_argument("--sources", nargs="+", default=[*config.REQUIRED_SOURCES, *config.OPTIONAL_SOURCES])
    p.add_argument("--dry-run", action="store_true", help="show the plan without fetching")
    args = parser.parse_args(argv)

    availability = ingestion.data_availability()
    cov = coverage()
    if args.cmd == "status":
        avail = availability.set_index("source")
        for s, ranges in cov["sources"].items():
            kind = "required" if s in config.REQUIRED_SOURCES else "optional"
            print(f"{s:16} ({kind}) FIRMS {avail.at[s, 'min_date']} → {avail.at[s, 'max_date']} | local: {_fmt(ranges)}")
        print(f"Covered periods (all required sources): {_fmt(cov['periods'])}")
        print(f"Default pull end: {default_end(availability)}")
        return

    end = args.end or default_end(availability)
    tasks = plan_pull(tuple(args.sources), args.start, end, availability)
    calls = sum(-(-((t.end - t.start).days + 1) // config.FIRMS_MAX_DAY_RANGE) for t in tasks)
    print(f"{len(tasks)} files to fetch, about {calls} API calls (limit {5000} per 10 minutes)")
    for t in tasks:
        print(f"  {t.source} {t.start} → {t.end}" + (f" (replaces {t.replaces.name})" if t.replaces else ""))
    if not args.dry_run and tasks:
        pull(tasks)


if __name__ == "__main__":
    main()
