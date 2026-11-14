"""Harmonization tests. All observations here are synthetic."""

import datetime as dt

import pandas as pd
import pytest

from eyes_on_karhutla import harmonization


# (source, satellite) per synthetic platform label, using codes observed in FIRMS SP data.
PLATFORM_FIELDS = {
    "terra": ("MODIS_SP", "Terra"),
    "aqua": ("MODIS_SP", "Aqua"),
    "snpp": ("VIIRS_SNPP_SP", "N"),
    "noaa20": ("VIIRS_NOAA20_SP", "N20"),
}


def _obs(rows, platforms=None):
    """Synthetic normalized observations; each row is (sensor, lat, lon, utc, conf, type, rid).

    ``platforms`` defaults to Terra for MODIS rows and S-NPP for VIIRS rows.
    """
    df = pd.DataFrame(
        rows, columns=["sensor", "latitude", "longitude", "acq_datetime", "confidence", "type", "source_record_id"]
    )
    df["acq_datetime"] = pd.to_datetime(df["acq_datetime"], utc=True)
    if platforms is None:
        platforms = ["terra" if s == "MODIS" else "snpp" for s in df["sensor"]]
    df["source"] = [PLATFORM_FIELDS[p][0] for p in platforms]
    df["satellite"] = [PLATFORM_FIELDS[p][1] for p in platforms]
    return df


def test_confidence_class_per_sensor_scale():
    sensor = pd.Series(["MODIS"] * 5 + ["VIIRS"] * 4)
    conf = pd.Series(["0", "29", "30", "79", "80", "l", "n", "h", "?"])
    assert harmonization.confidence_class(sensor, conf).tolist() == [
        "low", "low", "nominal", "nominal", "high", "low", "nominal", "high", pd.NA,
    ]


@pytest.mark.parametrize(
    "coord, expected",
    [(0.29, 29), (0.0, 0), (-0.001, -1), (-2.10, -210), (-2.105, -211), (113.999, 11399)],
)
def test_cell_index_floors_including_south_of_equator(coord, expected):
    assert harmonization.cell_index(pd.Series([coord])).iloc[0] == expected


def test_wib_date_rolls_over_at_17_utc():
    ts = pd.to_datetime(pd.Series(["2019-09-01 16:59", "2019-09-01 17:00"]), utc=True)
    assert harmonization.wib_date(ts).tolist() == [dt.date(2019, 9, 1), dt.date(2019, 9, 2)]


def test_prepare_excludes_non_vegetation_and_missing_type_with_reason():
    obs = _obs([
        ("MODIS", -2.1, 113.9, "2019-09-01 05:00", "70", 0, "a"),
        ("VIIRS", -2.1, 113.9, "2019-09-01 05:00", "n", 1, "b"),
        ("VIIRS", -2.1, 113.9, "2019-09-01 05:00", "n", None, "c"),
    ])
    kept, excluded = harmonization.prepare(obs)
    assert kept["source_record_id"].tolist() == ["a"]
    assert excluded.set_index("source_record_id")["exclusion_reason"].to_dict() == {
        "b": "non_vegetation_type", "c": "missing_type",
    }
    assert len(kept) + len(excluded) == len(obs)
    assert obs["confidence"].tolist() == ["70", "n", "n"]  # originals untouched


def test_prepare_requires_type_column():
    with pytest.raises(ValueError, match="type"):
        harmonization.prepare(_obs([]).drop(columns="type"))


def test_exclude_low_confidence_is_optional():
    obs = _obs([
        ("MODIS", -2.1, 113.9, "2019-09-01 05:00", "10", 0, "a"),
        ("VIIRS", -2.1, 113.9, "2019-09-01 05:00", "n", 0, "b"),
    ])
    assert len(harmonization.prepare(obs)[0]) == 2
    kept, excluded = harmonization.prepare(obs, exclude_low_confidence=True)
    assert kept["source_record_id"].tolist() == ["b"]
    assert excluded["exclusion_reason"].tolist() == ["low_confidence"]


def test_cell_day_collapses_redundant_viirs_and_keeps_provenance():
    obs = _obs([
        # Same cell, same WIB date: one MODIS + two VIIRS (S-NPP and NOAA-20).
        ("MODIS", -2.101, 113.905, "2019-09-01 06:00", "70", 0, "m1"),
        ("VIIRS", -2.103, 113.901, "2019-09-01 06:10", "n", 0, "v1"),
        ("VIIRS", -2.104, 113.902, "2019-09-01 05:20", "l", 0, "v2"),
        # Same cell, night pass after 17 UTC -> next WIB date, VIIRS only, low confidence.
        ("VIIRS", -2.105, 113.903, "2019-09-01 18:00", "l", 0, "v3"),
    ])
    obs = _obs(obs.iloc[:, :7].values.tolist(), platforms=["aqua", "snpp", "noaa20", "noaa20"])
    cd, excluded = harmonization.harmonize(obs)
    assert excluded.empty
    assert len(cd) == 2
    day1, day2 = cd.iloc[0], cd.iloc[1]
    assert (day1.cell_lat, day1.cell_lon, day1.wib_date) == (-2.11, 113.9, dt.date(2019, 9, 1))
    assert (day1.modis_hit, day1.viirs_hit, day1.n_modis, day1.n_viirs) == (True, True, 1, 2)
    assert not day1.low_conf_only
    assert sorted(day1.source_record_ids) == ["m1", "v1", "v2"]
    assert (day1.terra_hit, day1.aqua_hit, day1.snpp_hit, day1.noaa20_hit) == (False, True, True, True)
    assert (day2.snpp_hit, day2.noaa20_hit) == (False, True)
    assert day2.wib_date == dt.date(2019, 9, 2)
    assert (day2.modis_hit, day2.viirs_hit, day2.low_conf_only) == (False, True, True)
    # Traceability: every kept detection appears in exactly one cell-day.
    assert sum(len(ids) for ids in cd["source_record_ids"]) == len(obs)


def test_adjacent_cells_stay_separate():
    obs = _obs([
        ("MODIS", 0.009, 100.0, "2019-09-01 06:00", "70", 0, "a"),
        ("MODIS", 0.010, 100.0, "2019-09-01 06:00", "70", 0, "b"),
    ])
    cd, _ = harmonization.harmonize(obs)
    assert cd["cell_lat"].tolist() == [0.0, 0.01]


def test_unknown_confidence_is_not_low_only():
    obs = _obs([
        ("VIIRS", -2.1, 113.9, "2019-09-01 05:00", "l", 0, "a"),
        ("VIIRS", -2.1, 113.9, "2019-09-01 05:10", "?", 0, "b"),
        ("VIIRS", 1.1, 101.0, "2019-09-01 05:10", "?", 0, "c"),
    ])
    cd, _ = harmonization.harmonize(obs)
    assert cd["low_conf_only"].dtype == bool
    assert cd["low_conf_only"].tolist() == [False, False]


def test_unknown_platform_is_excluded_with_reason():
    obs = _obs([("MODIS", -2.1, 113.9, "2019-09-01 05:00", "70", 0, "a")])
    obs["satellite"] = "Unknown"
    kept, excluded = harmonization.prepare(obs)
    assert kept.empty
    assert excluded["exclusion_reason"].tolist() == ["unknown_platform"]


def test_harmonize_empty_input():
    cd, excluded = harmonization.harmonize(_obs([]))
    assert cd.empty and excluded.empty
    assert {"viirs_hit", "snpp_hit", "noaa20_hit"} <= set(cd.columns)


def test_merge_cell_days_joins_year_boundary_duplicates():
    # 31 Dec 18:00 UTC (MODIS, in the 2019 chunk) and 1 Jan 06:00 UTC (S-NPP, in the 2020 chunk)
    # are both 1 Jan 2020 WIB in the same cell.
    dec = _obs([("MODIS", -2.101, 113.905, "2019-12-31 18:00", "70", 0, "m")])
    jan = _obs([("VIIRS", -2.102, 113.906, "2020-01-01 06:00", "l", 0, "v")])
    chunks = [harmonization.harmonize(o)[0] for o in (dec, jan)]
    merged = harmonization.merge_cell_days(chunks)
    assert len(merged) == 1
    row = merged.iloc[0]
    assert row.wib_date == dt.date(2020, 1, 1)
    assert (row.modis_hit, row.viirs_hit, row.terra_hit, row.snpp_hit) == (True, True, True, True)
    assert (row.n_modis, row.n_viirs, row.low_conf_only) == (1, 1, False)   # not all detections low
    assert sorted(row.source_record_ids) == ["m", "v"]


def test_to_cell_days_can_drop_record_ids_and_merge_still_works():
    a = harmonization.to_cell_days(harmonization.prepare(_obs([("MODIS", 0.5, 100.5, "2019-12-31 18:00", "10", 0, "a")]))[0],
                                   keep_record_ids=False)
    b = harmonization.to_cell_days(harmonization.prepare(_obs([("MODIS", 0.5, 100.5, "2020-01-01 03:00", "10", 0, "b")]))[0],
                                   keep_record_ids=False)
    assert "source_record_ids" not in a.columns
    merged = harmonization.merge_cell_days([a, b])
    assert len(merged) == 1 and merged.iloc[0].n_modis == 2 and merged.iloc[0].low_conf_only
