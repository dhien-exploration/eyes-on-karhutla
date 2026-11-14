"""Visualization prep tests (synthetic daily series)."""

import datetime as dt
import math

import pandas as pd

from eyes_on_karhutla import activity, visualization


def _daily():
    cd = pd.DataFrame({"wib_date": [dt.date(2019, 8, 5)], "terra_hit": [True], "aqua_hit": [False],
                       "snpp_hit": [False], "noaa20_hit": [False], "noaa21_hit": [False]})
    return activity.daily_series(cd, dt.date(2019, 8, 1), dt.date(2019, 8, 7))  # Thu 1 – Thu 8 WIB


def test_calendar_grid_places_days_by_week_and_weekday():
    values, text = visualization.calendar_grid(_daily(), "modis")
    assert list(values.columns) == [dt.date(2019, 7, 29), dt.date(2019, 8, 5)]
    assert values.loc[0, dt.date(2019, 8, 5)] == 1           # Monday 5 Aug
    assert values.loc[1, dt.date(2019, 8, 5)] == 0           # quiet complete day is 0, not blank


def test_calendar_grid_blanks_partial_and_out_of_range_dates():
    values, text = visualization.calendar_grid(_daily(), "modis")
    assert math.isnan(values.loc[3, dt.date(2019, 7, 29)])   # Thu 1 Aug: partial
    assert "partial coverage" in text.loc[3, dt.date(2019, 7, 29)]
    assert math.isnan(values.loc[0, dt.date(2019, 7, 29)])   # Mon 29 Jul: before pull
    assert text.loc[0, dt.date(2019, 7, 29)] == "outside pull range"


def test_agreement_labels_name_the_series():
    assert visualization.agreement_labels("modis", "viirs_snpp")["b_only"] == "VIIRS S-NPP only"
