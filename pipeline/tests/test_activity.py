"""Activity aggregation tests. All cell-days here are synthetic."""

import datetime as dt

import pandas as pd

from eyes_on_karhutla import activity, config


def _cell_days(rows):
    """Synthetic cell-days; each row is (wib_date, set of platforms hit)."""
    columns = ["wib_date", *[f"{p}_hit" for p in config.PLATFORMS]]
    return pd.DataFrame(
        [{"wib_date": d, **{f"{p}_hit": p in hits for p in config.PLATFORMS}} for d, hits in rows],
        columns=columns,
    )


def test_wib_coverage_marks_edge_dates_partial():
    cov = activity.wib_date_coverage(dt.date(2019, 8, 1), dt.date(2019, 8, 3))
    assert list(cov.index) == [dt.date(2019, 8, d) for d in (1, 2, 3, 4)]
    assert cov["complete"].tolist() == [False, True, True, False]


def test_daily_series_side_by_side_zero_filled():
    cd = _cell_days([
        (dt.date(2019, 8, 2), {"terra", "snpp"}),
        (dt.date(2019, 8, 2), {"aqua", "noaa20"}),   # NOAA-20 only counts in viirs_all
        (dt.date(2019, 8, 2), {"noaa20"}),
    ])
    daily = activity.daily_series(cd, dt.date(2019, 8, 1), dt.date(2019, 8, 3), series=tuple(activity.SERIES))
    day2 = daily.loc[dt.date(2019, 8, 2)]
    assert (day2.modis, day2.viirs_snpp, day2.viirs_all) == (2, 1, 3)
    assert daily.loc[dt.date(2019, 8, 3), ["modis", "viirs_snpp", "viirs_all"]].tolist() == [0, 0, 0]


def test_default_series_is_constellation_consistent_pair():
    daily = activity.daily_series(_cell_days([]), dt.date(2019, 8, 1), dt.date(2019, 8, 2))
    assert [c for c in daily.columns if c in activity.SERIES] == ["modis", "viirs_snpp"]


def test_aggregate_uses_complete_days_and_reports_coverage():
    cd = _cell_days([
        (dt.date(2019, 8, 1), {"terra"}),   # partial edge date: excluded from sums
        (dt.date(2019, 8, 2), {"terra"}),
        (dt.date(2019, 8, 31), {"terra", "snpp"}),
        (dt.date(2019, 9, 1), {"snpp"}),
    ])
    daily = activity.daily_series(cd, dt.date(2019, 8, 1), dt.date(2019, 9, 1))
    monthly = activity.aggregate(daily, "M")
    aug, sep = monthly.loc[pd.Period("2019-08")], monthly.loc[pd.Period("2019-09")]
    assert (aug.modis, aug.viirs_snpp, aug.n_complete_days, aug.n_days) == (2, 1, 30, 31)
    assert (sep.modis, sep.viirs_snpp, sep.n_complete_days, sep.n_days) == (0, 1, 1, 30)


def test_sensor_agreement_and_ratio():
    cd = _cell_days([
        (dt.date(2019, 8, 2), {"terra", "snpp"}),
        (dt.date(2019, 8, 2), {"aqua"}),
        (dt.date(2019, 8, 2), {"noaa20"}),          # neither modis nor viirs_snpp
        (dt.date(2019, 8, 3), {"snpp"}),
    ])
    agreement = activity.sensor_agreement(cd)
    assert agreement.tolist()[:2] == ["both", "a_only"]
    assert pd.isna(agreement.iloc[2]) and agreement.iloc[3] == "b_only"
    daily = activity.daily_series(cd, dt.date(2019, 8, 1), dt.date(2019, 8, 3))
    ratio = activity.series_ratio(daily, "viirs_snpp", "modis")
    assert ratio.loc[dt.date(2019, 8, 2)] == 0.5
    assert pd.isna(ratio.loc[dt.date(2019, 8, 3)])   # MODIS 0 -> NaN, not inf
    assert dt.date(2019, 8, 1) not in ratio.index    # partial date left out


def test_coverage_status_partial_edges_and_missing_gap():
    cov = activity.coverage_status([(dt.date(2020, 1, 1), dt.date(2020, 1, 2)), (dt.date(2020, 1, 6), dt.date(2020, 1, 6))])
    assert cov["status"].to_dict() == {
        dt.date(2020, 1, 1): "partial", dt.date(2020, 1, 2): "complete", dt.date(2020, 1, 3): "partial",
        dt.date(2020, 1, 4): "missing", dt.date(2020, 1, 5): "missing",
        dt.date(2020, 1, 6): "partial", dt.date(2020, 1, 7): "partial",
    }


def test_daily_with_status_nulls_missing_and_period_series_sums_complete_only():
    cov = activity.coverage_status([(dt.date(2020, 1, 1), dt.date(2020, 1, 30)), (dt.date(2020, 3, 5), dt.date(2020, 3, 31))])
    cd = _cell_days([
        (dt.date(2020, 1, 1), {"terra"}),     # partial date: shown daily, not summed
        (dt.date(2020, 1, 15), {"terra", "snpp"}),
        (dt.date(2020, 3, 20), {"snpp"}),
    ])
    daily = activity.daily_with_status(cd, cov)
    assert daily.loc[dt.date(2020, 1, 1), "modis"] == 1
    assert pd.isna(daily.loc[dt.date(2020, 2, 10), "modis"])          # missing date is NA, not 0
    assert daily.loc[dt.date(2020, 1, 20), "modis"] == 0               # covered quiet day is 0
    monthly = activity.period_series(daily, "M")
    assert monthly["status"].tolist() == ["partial", "missing", "partial", "partial"]  # Jan, Feb, Mar, Apr(1st)
    jan, feb = monthly.loc[pd.Period("2020-01")], monthly.loc[pd.Period("2020-02")]
    assert (jan.modis, jan.viirs_snpp) == (1, 1)
    assert pd.isna(feb.modis)
    yearly = activity.period_series(daily, "Y")
    assert yearly.loc[pd.Period("2020"), "viirs_snpp"] == 2 and yearly.loc[pd.Period("2020"), "status"] == "partial"
