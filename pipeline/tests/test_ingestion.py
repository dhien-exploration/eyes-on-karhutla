from datetime import date

import pandas as pd
import pytest

from eyes_on_karhutla import ingestion

BBOX = (94.0, -11.5, 141.5, 6.5)
CSV_HEADER = "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight\n"


def test_build_area_url_format():
    url = ingestion.build_area_url("VIIRS_SNPP_SP", BBOX, 5, date(2019, 9, 1), map_key="KEY")
    assert url == (
        "https://firms.modaps.eosdis.nasa.gov/api/area/csv/KEY/VIIRS_SNPP_SP/94,-11.5,141.5,6.5/5/2019-09-01"
    )


@pytest.mark.parametrize("days", [0, 6])
def test_build_area_url_rejects_bad_day_range(days):
    with pytest.raises(ValueError):
        ingestion.build_area_url("MODIS_SP", BBOX, days, map_key="KEY")


def test_build_area_url_rejects_unknown_source():
    with pytest.raises(ValueError):
        ingestion.build_area_url("LANDSAT_NRT", BBOX, 1, map_key="KEY")


class FakeResponse:
    def __init__(self, text):
        self.text = text

    def raise_for_status(self):
        pass


class FakeSession:
    def __init__(self, text):
        self.text = text
        self.urls = []

    def get(self, url, timeout):
        self.urls.append(url)
        return FakeResponse(self.text)


def test_fetch_area_chunks_and_redacts_key():
    body = CSV_HEADER + "-2.1,113.9,330.1,0.4,0.6,2019-09-01,0542,N,VIIRS,n,2,290.0,5.2,D\n"
    session = FakeSession(body)
    df = ingestion.fetch_area("VIIRS_SNPP_SP", BBOX, date(2019, 9, 1), date(2019, 9, 12), "SECRET", session)
    # 12 days -> windows of 5, 5, 2
    assert [u.rsplit("/", 2)[-2:] for u in session.urls] == [
        ["5", "2019-09-01"], ["5", "2019-09-06"], ["2", "2019-09-11"]
    ]
    assert len(df) == 3
    assert not df["source_ref"].str.contains("SECRET").any()
    assert (df["acq_time"] == "0542").all()  # leading zero preserved


def test_fetch_area_raises_on_text_error():
    with pytest.raises(RuntimeError, match="Unexpected FIRMS response"):
        ingestion.fetch_area("MODIS_SP", BBOX, date(2019, 9, 1), date(2019, 9, 1), "K", FakeSession("Invalid MAP_KEY."))


def test_latest_raw_picks_newest_for_source(tmp_path):
    for name in ["modis_sp_x_20260101T000000Z.csv", "modis_sp_x_20260201T000000Z.csv", "viirs_snpp_sp_x_20260301T000000Z.csv"]:
        (tmp_path / name).write_text(CSV_HEADER)
    assert ingestion.latest_raw("MODIS_SP", tmp_path).name == "modis_sp_x_20260201T000000Z.csv"
    with pytest.raises(FileNotFoundError):
        ingestion.latest_raw("VIIRS_NOAA20_SP", tmp_path)


def test_fetch_area_header_only_returns_empty_frame():
    df = ingestion.fetch_area("MODIS_SP", BBOX, date(2019, 9, 1), date(2019, 9, 1), "K", FakeSession(CSV_HEADER))
    assert df.empty
    assert {"source", "source_ref", "retrieved_at"} <= set(df.columns)


def test_pull_range_from_raw_file_name():
    assert ingestion.pull_range("data/raw/modis_sp_2019-08-01_2019-10-31_20261019T172402Z.csv") == (
        date(2019, 8, 1), date(2019, 10, 31))
    with pytest.raises(ValueError):
        ingestion.pull_range("modis_sp_2019-09.csv")


class ScriptedSession:
    """Returns the scripted outcomes in order: an int status, a requests exception, or CSV text."""

    def __init__(self, outcomes):
        self.outcomes, self.calls = list(outcomes), 0

    def get(self, url, timeout):
        self.calls += 1
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        if isinstance(outcome, tuple):            # (status, body)
            resp = FakeResponse(outcome[1])
            resp.status_code = outcome[0]
        else:
            resp = FakeResponse(outcome if isinstance(outcome, str) else "")
            resp.status_code = 200 if isinstance(outcome, str) else outcome
        return resp


def test_fetch_area_retries_transient_errors(monkeypatch):
    import requests
    monkeypatch.setattr(ingestion.time, "sleep", lambda s: None)
    body = CSV_HEADER + "1.0,100.0,300,0.4,0.4,2019-09-01,0600,N,VIIRS,n,2,290,3.1,D\n"
    s = ScriptedSession([504, requests.ConnectionError("https://x/SECRETKEY"), body])
    df = ingestion.fetch_area("VIIRS_SNPP_SP", BBOX, date(2019, 9, 1), date(2019, 9, 1), map_key="SECRETKEY", session=s)
    assert len(df) == 1 and s.calls == 3


def test_fetch_area_errors_never_contain_the_key(monkeypatch):
    monkeypatch.setattr(ingestion.time, "sleep", lambda s: None)
    s = ScriptedSession([504] * (len(ingestion.RETRY_BACKOFF_S) + 1))
    with pytest.raises(RuntimeError) as err:
        ingestion.fetch_area("VIIRS_SNPP_SP", BBOX, date(2019, 9, 1), date(2019, 9, 1), map_key="SECRETKEY", session=s)
    assert "SECRETKEY" not in str(err.value) and "<MAP_KEY>" in str(err.value)
    assert err.value.__cause__ is None and err.value.__suppress_context__
    with pytest.raises(RuntimeError, match="HTTP 403") as err:   # client errors fail at once, also redacted
        ingestion.fetch_area("VIIRS_SNPP_SP", BBOX, date(2019, 9, 1), date(2019, 9, 1), map_key="SECRETKEY",
                             session=ScriptedSession([403]))
    assert "SECRETKEY" not in str(err.value)


def test_fetch_area_resumes_from_window_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(ingestion.time, "sleep", lambda s: None)
    body = CSV_HEADER + "1.0,100.0,300,0.4,0.4,2019-09-01,0600,N,VIIRS,n,2,290,3.1,D\n"
    # First run: window 1 succeeds, window 2 keeps failing.
    first = ScriptedSession([body] + [504] * (len(ingestion.RETRY_BACKOFF_S) + 1))
    with pytest.raises(RuntimeError):
        ingestion.fetch_area("VIIRS_SNPP_SP", BBOX, date(2019, 9, 1), date(2019, 9, 10), map_key="K",
                             session=first, cache_dir=tmp_path)
    assert sorted(p.name for p in tmp_path.iterdir()) == ["2019-09-01_5.csv"]
    # Second run only requests the missing window.
    second = ScriptedSession([body])
    seen = []
    df = ingestion.fetch_area("VIIRS_SNPP_SP", BBOX, date(2019, 9, 1), date(2019, 9, 10), map_key="K",
                              session=second, cache_dir=tmp_path, on_window=lambda d, t: seen.append((d, t)))
    assert second.calls == 1 and len(df) == 2 and seen == [(1, 2), (2, 2)]


def test_fetch_area_waits_out_the_firms_transaction_limit(monkeypatch):
    waits = []
    monkeypatch.setattr(ingestion.time, "sleep", waits.append)
    body = CSV_HEADER + "1.0,100.0,300,0.4,0.4,2019-09-01,0600,N,VIIRS,n,2,290,3.1,D\n"
    limited = (400, "Exceeding allowed transaction limit.")
    s = ScriptedSession([limited, (403, "Exceeding allowed transaction limit."), body])
    df = ingestion.fetch_area("VIIRS_SNPP_SP", BBOX, date(2019, 9, 1), date(2019, 9, 1), map_key="K", session=s)
    assert len(df) == 1 and waits == [ingestion.RATE_LIMIT_WAIT_S] * 2
    with pytest.raises(RuntimeError, match="transaction limit still exceeded"):
        ingestion.fetch_area("VIIRS_SNPP_SP", BBOX, date(2019, 9, 1), date(2019, 9, 1), map_key="K",
                             session=ScriptedSession([limited] * (ingestion.RATE_LIMIT_MAX_WAITS + 1)))
    with pytest.raises(RuntimeError, match="HTTP 400"):     # other 400s still fail at once
        ingestion.fetch_area("VIIRS_SNPP_SP", BBOX, date(2019, 9, 1), date(2019, 9, 1), map_key="K",
                             session=ScriptedSession([(400, "Invalid area")]))
