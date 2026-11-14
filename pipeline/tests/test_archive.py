"""Archive layout, pull planning and coverage tests. Files and availability are synthetic."""

import datetime as dt

import pandas as pd
import pytest

from eyes_on_karhutla import archive, ingestion

D = dt.date


def _availability(**ranges):
    return pd.DataFrame([{"source": s, "min_date": a, "max_date": b} for s, (a, b) in ranges.items()])


def _touch(root, source, start, end):
    path = archive.file_path(source, start, end, root)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("latitude,longitude\n")
    return path


def test_plan_pull_clamps_to_request_and_availability(tmp_path):
    avail = _availability(MODIS_SP=(D(2000, 11, 1), D(2026, 7, 31)), VIIRS_NOAA20_SP=(D(2018, 4, 1), D(2026, 6, 30)))
    tasks = archive.plan_pull(("MODIS_SP", "VIIRS_NOAA20_SP"), D(2017, 6, 1), D(2018, 12, 31), avail, tmp_path)
    assert [(t.source, t.start, t.end) for t in tasks] == [
        ("MODIS_SP", D(2017, 6, 1), D(2017, 12, 31)),
        ("MODIS_SP", D(2018, 1, 1), D(2018, 12, 31)),
        ("VIIRS_NOAA20_SP", D(2018, 4, 1), D(2018, 12, 31)),   # starts at availability
    ]
    assert tasks[0].path == tmp_path / "modis_sp" / "2017-06-01_2017-12-31.csv"


def test_plan_pull_skips_covered_and_replaces_partial_years(tmp_path):
    _touch(tmp_path, "MODIS_SP", D(2019, 1, 1), D(2019, 12, 31))
    partial = _touch(tmp_path, "MODIS_SP", D(2026, 1, 1), D(2026, 3, 31))
    avail = _availability(MODIS_SP=(D(2000, 11, 1), D(2026, 7, 31)))
    tasks = archive.plan_pull(("MODIS_SP",), D(2019, 6, 1), D(2026, 12, 31), avail, tmp_path)
    years = [t.start.year for t in tasks]
    assert 2019 not in years                          # already covered
    last = tasks[-1]
    assert (last.start, last.end, last.replaces) == (D(2026, 1, 1), D(2026, 7, 31), partial)


def test_list_files_rejects_overlaps_and_bad_names(tmp_path):
    _touch(tmp_path, "MODIS_SP", D(2019, 1, 1), D(2019, 6, 30))
    _touch(tmp_path, "MODIS_SP", D(2019, 6, 1), D(2019, 12, 31))
    with pytest.raises(ValueError, match="Overlapping"):
        archive.list_files("MODIS_SP", tmp_path)
    (tmp_path / "viirs_snpp_sp").mkdir()
    (tmp_path / "viirs_snpp_sp" / "notes.csv").write_text("x")
    with pytest.raises(ValueError, match="Unexpected file"):
        archive.list_files("VIIRS_SNPP_SP", tmp_path)


def test_coverage_is_intersection_of_required_sources_with_gaps(tmp_path):
    for start, end in [(D(2019, 1, 1), D(2019, 12, 31)), (D(2020, 1, 1), D(2020, 3, 31))]:
        _touch(tmp_path, "MODIS_SP", start, end)
    _touch(tmp_path, "VIIRS_SNPP_SP", D(2019, 6, 1), D(2019, 12, 31))   # adjacent files merge
    _touch(tmp_path, "VIIRS_SNPP_SP", D(2020, 2, 1), D(2020, 6, 30))
    _touch(tmp_path, "VIIRS_NOAA20_SP", D(2019, 1, 1), D(2019, 1, 31))   # optional: not in periods
    cov = archive.coverage(root=tmp_path)
    assert cov["sources"]["MODIS_SP"] == [(D(2019, 1, 1), D(2020, 3, 31))]
    assert cov["periods"] == [(D(2019, 6, 1), D(2019, 12, 31)), (D(2020, 2, 1), D(2020, 3, 31))]
    assert cov["sources"]["VIIRS_NOAA21_SP"] == []


def test_default_end_is_earliest_required_max_date():
    avail = _availability(MODIS_SP=(D(2000, 11, 1), D(2026, 7, 31)), VIIRS_SNPP_SP=(D(2012, 1, 20), D(2026, 6, 30)))
    assert archive.default_end(avail) == D(2026, 6, 30)


class FakeSession:
    def __init__(self, text):
        self.text, self.urls = text, []

    def get(self, url, timeout):
        self.urls.append(url)
        return type("R", (), {"text": self.text, "raise_for_status": lambda self: None})()


def test_data_availability_parses_dates():
    s = FakeSession("data_id,min_date,max_date\nMODIS_SP,2000-11-01,2026-07-31\n")
    df = ingestion.data_availability(map_key="KEY", session=s)
    assert df.to_dict("records") == [{"source": "MODIS_SP", "min_date": D(2000, 11, 1), "max_date": D(2026, 7, 31)}]
    assert s.urls == ["https://firms.modaps.eosdis.nasa.gov/api/data_availability/csv/KEY/all"]
    with pytest.raises(RuntimeError):
        ingestion.data_availability(map_key="KEY", session=FakeSession("Invalid MAP_KEY"))
