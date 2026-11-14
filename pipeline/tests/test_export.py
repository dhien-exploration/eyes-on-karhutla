"""Multi-year pipeline + export tests on a synthetic archive (all data synthetic).

Covered periods: 2019-12-01 → 2020-01-10 and 2020-01-31 → 2020-02-29 (gap in January),
so WIB 2020-02 is the only complete month.
"""

import datetime as dt
import json

import geopandas as gpd
import pandas as pd
import pytest
from shapely.geometry import box

from eyes_on_karhutla import archive, export, pipeline

D = dt.date
META = {"name": "synthetic", "source": "test squares", "license": "n/a", "year_represented": 2026, "url": "n/a"}
FILES = {
    "MODIS_SP": [(D(2019, 12, 1), D(2019, 12, 31)), (D(2020, 1, 1), D(2020, 1, 10)), (D(2020, 1, 31), D(2020, 2, 29))],
    "VIIRS_SNPP_SP": [(D(2019, 12, 1), D(2019, 12, 31)), (D(2020, 1, 1), D(2020, 1, 10)), (D(2020, 1, 31), D(2020, 2, 29))],
    "VIIRS_NOAA20_SP": [(D(2019, 12, 1), D(2019, 12, 31)), (D(2020, 1, 11), D(2020, 1, 30))],
}
SATELLITE = {"MODIS_SP": "Terra", "VIIRS_SNPP_SP": "N", "VIIRS_NOAA20_SP": "N20"}
# (source, lat, lon, acq_date, acq_time HHMM UTC, confidence, type)
DETECTIONS = [
    ("MODIS_SP", 0.501, 100.501, "2019-12-31", "1800", "70", 0),     # 1 Jan 2020 WIB, from the 2019 file
    ("VIIRS_SNPP_SP", 0.502, 100.502, "2020-01-01", "0600", "n", 0),  # same cell + WIB date, 2020 file
    ("VIIRS_SNPP_SP", 0.5, 100.7, "2019-12-10", "0600", "n", 0),      # Alpha, Dec 2019
    ("VIIRS_NOAA20_SP", 0.5, 101.5, "2019-12-10", "0600", "l", 0),    # Beta, viirs_all only
    ("VIIRS_NOAA20_SP", 0.5, 101.5, "2020-01-20", "0600", "n", 0),    # in the gap -> outside_coverage
    ("MODIS_SP", 0.5, 105.0, "2020-02-15", "0300", "70", 0),          # outside every province
    ("MODIS_SP", 0.5, 101.6, "2020-02-15", "0300", "70", 2),          # static source -> excluded
    ("MODIS_SP", 0.5, 101.6, "2020-02-16", "0300", "70", 0),          # Beta, complete month
]


def _write_archive(root):
    for source, ranges in FILES.items():
        for start, end in ranges:
            rows = [d for d in DETECTIONS if d[0] == source and start <= D.fromisoformat(d[3]) <= end]
            df = pd.DataFrame([{"latitude": d[1], "longitude": d[2], "acq_date": d[3], "acq_time": d[4],
                                "satellite": SATELLITE[source], "confidence": d[5], "type": d[6], "frp": 1.0}
                               for d in rows],
                              columns=["latitude", "longitude", "acq_date", "acq_time", "satellite", "confidence",
                                       "type", "frp"])
            path = archive.file_path(source, start, end, root)
            path.parent.mkdir(parents=True, exist_ok=True)
            df.to_csv(path, index=False)


def _provinces():
    return gpd.GeoDataFrame({"province_id": ["ID-AA", "ID-BB"], "name": ["Alpha", "Beta"]},
                            geometry=[box(100, 0, 101, 1), box(101, 0, 102, 1)], crs=4326)


@pytest.fixture
def result(tmp_path):
    _write_archive(tmp_path)
    return pipeline.run_archive(root=tmp_path)


@pytest.fixture
def products(result):
    return export.build_products(result, _provinces(), boundaries_meta=META)


def test_run_archive_merges_year_boundary_and_records_exclusions(result):
    assert result.periods == [(D(2019, 12, 1), D(2020, 1, 10)), (D(2020, 1, 31), D(2020, 2, 29))]
    boundary = result.cell_days[result.cell_days["wib_date"] == D(2020, 1, 1)]
    assert len(boundary) == 1 and boundary.iloc[0].modis_hit and boundary.iloc[0].snpp_hit
    reasons = result.exclusions.set_index(["source", "reason"])["rows"].to_dict()
    assert reasons == {("VIIRS_NOAA20_SP", "outside_coverage"): 1, ("MODIS_SP", "non_vegetation_type"): 1}
    assert set(result.platform_seen) == {"terra", "snpp", "noaa20"}
    assert "source_record_ids" not in result.cell_days.columns


def test_products_validate_and_every_field_is_typed(products):
    export.validate_products(products)


def test_layout_and_manifest_paths(products):
    m = products["manifest.json"]
    assert m["coverage"]["years"] == {"2019": "partial", "2020": "partial"}
    assert m["coverage"]["months"] == {"2019-12": "partial", "2020-01": "partial", "2020-02": "complete",
                                       "2020-03": "partial"}
    alpha = next(p for p in m["provinces"] if p["province_id"] == "ID-AA")
    assert alpha["cells"] == {"2019": "provinces/ID-AA/cells/2019.geojson", "2020": "provinces/ID-AA/cells/2020.geojson"}
    for p in m["provinces"]:
        for path in [p["daily"], p["monthly"], *p["cells"].values()]:
            assert path in products


def test_missing_is_null_not_zero(products):
    daily = products["provinces/ID-AA/daily.json"]
    i_gap, i_quiet = daily["dates"].index("2020-01-20"), daily["dates"].index("2020-02-10")
    assert (daily["status"][i_gap], daily["modis"][i_gap]) == ("missing", None)
    assert (daily["status"][i_quiet], daily["modis"][i_quiet]) == ("complete", 0)


def test_indonesia_excludes_outside_cells_and_years_add_up(products):
    t = products["manifest.json"]["totals"]
    assert t["outside_provinces_by_year"]["2020"]["modis"] == 1       # the 105°E cell
    assert t["indonesia_by_year"]["2020"]["modis"] == 2               # 1 Jan boundary cell + Beta 16 Feb
    assert t["indonesia_by_year"]["2019"] == {"modis": 0, "viirs_snpp": 1, "viirs_all": 2}
    beta = next(f["properties"] for f in products["provinces.geojson"]["features"] if f["properties"]["province_id"] == "ID-BB")
    assert beta["totals_by_year"]["2019"]["viirs_all"] == 1 and beta["totals_by_year"]["2019"]["viirs_snpp"] == 0
    national = products["monthly.json"]
    assert national["province_id"] is None and national["scope"] == "indonesia"
    feb = national["months"].index("2020-02")
    assert (national["status"][feb], national["modis"][feb]) == ("complete", 1)


def test_cells_are_split_by_wib_year(products):
    c2020 = products["provinces/ID-AA/cells/2020.geojson"]
    assert (c2020["year"], c2020["province_id"]) == (2020, "ID-AA")
    p = c2020["features"][0]["properties"]
    assert p["dates"] == ["2020-01-01"] and p["modis"] == [True] and p["viirs_snpp"] == [True]
    c2019 = products["provinces/ID-AA/cells/2019.geojson"]
    assert [f["properties"]["dates"] for f in c2019["features"]] == [["2019-12-10"]]


def test_platform_periods_end_null_when_seen_in_final_month(products):
    pp = products["manifest.json"]["series"]["viirs_all"]["platform_periods"]
    assert pp["noaa20"] == {"start": "2019-12-10", "end": "2019-12-10"}   # last seen before the final month
    assert products["manifest.json"]["series"]["modis"]["platform_periods"]["terra"]["end"] is None


def test_write_writes_all_schemas(products, tmp_path):
    out = tmp_path / "v1"
    export.write_products(products.items(), out)
    assert sorted(p.name for p in (out / "schema").iterdir()) == [
        "cells.schema.json", "daily.schema.json", "manifest.schema.json", "monthly.schema.json", "provinces.schema.json"]
    assert (out / "provinces" / "ID-BB" / "cells" / "2020.geojson").exists()


def test_edge_date_in_year_without_complete_date_is_trimmed_and_recorded(tmp_path):
    # Pull ends 31 Dec 2019 UTC: 1 Jan 2020 WIB is a 7-hour partial date in a year with no complete date.
    for source in ("MODIS_SP", "VIIRS_SNPP_SP"):
        path = archive.file_path(source, D(2019, 12, 1), D(2019, 12, 31), tmp_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        rows = "latitude,longitude,acq_date,acq_time,satellite,confidence,type,frp\n"
        if source == "MODIS_SP":
            rows += "0.5,100.5,2019-12-31,1800,Terra,70,0,1.0\n"     # 1 Jan 2020 WIB
        path.write_text(rows)
    products = export.build_products(pipeline.run_archive(root=tmp_path), _provinces(), boundaries_meta=META)
    cov = products["manifest.json"]["coverage"]
    assert cov["years"] == {"2019": "partial"}
    assert cov["trimmed"]["dates"] == ["2020-01-01"] and cov["trimmed"]["cell_days"] == 1
    assert cov["last_date"] == "2019-12-31" and "2020-01" not in cov["months"]
    assert all("2020" not in p["cells"] for p in products["manifest.json"]["provinces"])
    export.validate_products(products)


def test_streaming_writer_matches_dict_build_and_leaves_output_untouched_on_failure(result, tmp_path):
    out = tmp_path / "v1"
    summary = export.write_products(export.iter_products(result, _provinces(), boundaries_meta=META), out)
    built = export.build_products(result, _provinces(), boundaries_meta=META)
    on_disk = {p.relative_to(out).as_posix(): json.loads(p.read_text())
               for p in out.rglob("*json") if "schema" not in p.parts}
    for doc in (on_disk, built):
        doc["manifest.json"].pop("generated_at")
    assert on_disk == built and set(summary) == {"manifest.json", "provinces.geojson", "monthly.json"}

    def broken():
        yield from export.iter_products(result, _provinces(), boundaries_meta=META)
        raise AssertionError("late failure")
    before = sorted(p.relative_to(out).as_posix() for p in out.rglob("*"))
    with pytest.raises(AssertionError, match="late failure"):
        export.write_products(broken(), out)
    assert sorted(p.relative_to(out).as_posix() for p in out.rglob("*")) == before
    assert not (tmp_path / "v1.tmp-export").exists()


def test_write_refuses_a_folder_that_is_not_a_previous_export(products, tmp_path):
    other = tmp_path / "not-an-export"
    other.mkdir()
    (other / "keep.txt").write_text("x")
    with pytest.raises(FileExistsError):
        export.write_products(products.items(), other)
    assert (other / "keep.txt").exists()
    out = tmp_path / "v1"
    export.write_products(products.items(), out)
    export.write_products(products.items(), out)  # re-export over a previous export is fine
    assert json.loads((out / "manifest.json").read_text())["schema_version"] == export.SCHEMA_VERSION


def test_validation_rejects_broken_documents(products):
    for mutate, kind in [
        (lambda p: p["provinces/ID-AA/daily.json"]["modis"].__setitem__(0, -1), "daily"),
        (lambda p: p["manifest.json"]["coverage"].update(first_date="Dec 1"), "manifest"),
        (lambda p: p["provinces/ID-AA/cells/2020.geojson"]["features"][0]["geometry"].update(coordinates=[100.5]),
         "cells"),
        (lambda p: p["provinces.geojson"]["features"][0]["properties"].update(totals_by_year={"20": {}}), "provinces"),
    ]:
        broken = json.loads(json.dumps(products))
        mutate(broken)
        with pytest.raises(ValueError, match=f"fails the {kind} schema"):
            export.validate_products(broken)


def test_new_field_without_schema_type_is_rejected(products):
    products["manifest.json"]["boundaries"]["new_field"] = "x"
    with pytest.raises(ValueError, match=r"does not type: \['boundaries.new_field'\]"):
        export.validate_products(products)
