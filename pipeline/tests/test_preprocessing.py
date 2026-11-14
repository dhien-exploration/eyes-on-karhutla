import pandas as pd

from eyes_on_karhutla import preprocessing


def _raw(**overrides):
    base = {
        "latitude": [-2.1, 0.5],
        "longitude": [113.9, 101.4],
        "acq_date": ["2019-09-01", "2019-09-02"],
        "acq_time": ["542", "1830"],
        "satellite": ["Terra", "N"],
        "confidence": ["78", "h"],
        "frp": [12.3, None],
        "source": ["MODIS_SP", "VIIRS_SNPP_SP"],
        "source_ref": ["test", "test"],
    }
    base.update(overrides)
    return pd.DataFrame(base)


def test_parse_acq_datetime_pads_hhmm_as_utc():
    ts = preprocessing.parse_acq_datetime(pd.Series(["2019-09-01"]), pd.Series(["5"]))
    assert ts.iloc[0] == pd.Timestamp("2019-09-01 00:05", tz="UTC")


def test_normalize_maps_sensor_and_keeps_originals():
    obs, excluded = preprocessing.normalize(_raw())
    assert excluded.empty
    assert list(obs["sensor"]) == ["MODIS", "VIIRS"]
    assert list(obs["satellite"]) == ["Terra", "N"]
    assert list(obs["confidence"]) == ["78", "h"]
    assert obs["acq_datetime"].iloc[0] == pd.Timestamp("2019-09-01 05:42", tz="UTC")
    assert obs["source_record_id"].is_unique


def test_normalize_record_id_is_deterministic():
    a, _ = preprocessing.normalize(_raw())
    b, _ = preprocessing.normalize(_raw())
    assert list(a["source_record_id"]) == list(b["source_record_id"])


def test_normalize_excludes_with_reason_instead_of_dropping():
    raw = _raw(latitude=[95.0, 0.5], acq_date=["2019-09-01", "not-a-date"])
    obs, excluded = preprocessing.normalize(raw)
    assert obs.empty
    assert sorted(excluded["exclusion_reason"]) == ["invalid_acq_datetime", "invalid_coordinates"]
    assert len(obs) + len(excluded) == len(raw)


def test_normalize_flags_unknown_source():
    obs, excluded = preprocessing.normalize(_raw(source=["MODIS_SP", "SOMETHING"]))
    assert len(obs) == 1
    assert excluded["exclusion_reason"].tolist() == ["unknown_source"]
