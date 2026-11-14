"""Assign harmonized cell-days to regions (provinces).

A cell-day belongs to the province containing its cell **centre**. Cells whose
centre is outside every province (sea, coast, neighbouring countries in the
FIRMS bbox) get NA: they are reported as "outside provinces", never dropped.
"""

from __future__ import annotations

from pathlib import Path

import geopandas as gpd
import pandas as pd

from eyes_on_karhutla import config


def load_provinces(path: str | Path | None = None) -> gpd.GeoDataFrame:
    """Province polygons with ``province_id`` (ISO 3166-2) and ``name``, sorted by id."""
    meta = config.BOUNDARIES
    gdf = gpd.read_file(path or meta["path"]).to_crs(4326)
    gdf = gdf.rename(columns={meta["id_field"]: "province_id", meta["name_field"]: "name"})
    if gdf["province_id"].isna().any() or not gdf["province_id"].is_unique:
        raise ValueError("Province ids must be present and unique")
    return gdf[["province_id", "name", "geometry"]].sort_values("province_id").reset_index(drop=True)


def assign_provinces(
    cell_days: pd.DataFrame,
    provinces: gpd.GeoDataFrame,
    grid_deg: float = config.HARMONIZATION_GRID_DEG,
) -> pd.Series:
    """``province_id`` per cell-day (NA when the cell centre is in no province).

    Uses ``intersects`` so a centre exactly on a shared border is not lost as
    "outside"; it matches both provinces and the first ``province_id`` in sort
    order wins, so the result is deterministic.
    """
    cells = cell_days[["cell_lat", "cell_lon"]].drop_duplicates()
    points = gpd.GeoDataFrame(
        cells,
        geometry=gpd.points_from_xy(cells["cell_lon"] + grid_deg / 2, cells["cell_lat"] + grid_deg / 2),
        crs=4326,
    )
    joined = gpd.sjoin(points, provinces[["province_id", "geometry"]], how="left", predicate="intersects")
    joined = joined.sort_values("province_id").loc[lambda d: ~d.index.duplicated()]
    lookup = joined.set_index(["cell_lat", "cell_lon"])["province_id"]
    keys = pd.MultiIndex.from_frame(cell_days[["cell_lat", "cell_lon"]])
    return pd.Series(lookup.reindex(keys).to_numpy(), index=cell_days.index, dtype="string", name="province_id")
