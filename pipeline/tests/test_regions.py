"""Region assignment tests. All geometries are synthetic."""

import geopandas as gpd
import pandas as pd
from shapely.geometry import box

from eyes_on_karhutla import regions


def _provinces():
    # Two adjacent unit squares sharing the meridian 101°E.
    return gpd.GeoDataFrame(
        {"province_id": ["ID-AA", "ID-BB"], "name": ["Alpha", "Beta"]},
        geometry=[box(100, 0, 101, 1), box(101, 0, 102, 1)], crs=4326,
    )


def test_assign_provinces_by_cell_centre_with_outside_as_na():
    cd = pd.DataFrame({"cell_lat": [0.5, 0.5, 0.5], "cell_lon": [100.5, 101.5, 105.0]})
    assert regions.assign_provinces(cd, _provinces()).tolist() == ["ID-AA", "ID-BB", pd.NA]


def test_assign_provinces_border_tie_is_deterministic():
    # Cell centre lands exactly on the shared edge at 101°E: it touches both; first id wins.
    cd = pd.DataFrame({"cell_lat": [0.5, 0.5], "cell_lon": [100.995, 100.98]})
    assert regions.assign_provinces(cd, _provinces()).tolist() == ["ID-AA", "ID-AA"]
