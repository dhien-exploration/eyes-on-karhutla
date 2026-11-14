"""Project-wide configuration: paths, FIRMS constants, and study area."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = PROJECT_ROOT / "data"
RAW_DIR = DATA_DIR / "raw"
# Multi-year raw archive: {ARCHIVE_DIR}/{source_lower}/{start}_{end}.csv (lode/export/multi-year-archive.md)
ARCHIVE_DIR = RAW_DIR / "firms"
PROCESSED_DIR = DATA_DIR / "processed"

load_dotenv(PROJECT_ROOT / ".env")

# NASA FIRMS area API (verified 2026-10-20 at https://firms.modaps.eosdis.nasa.gov/api/area/):
#   /api/area/csv/[MAP_KEY]/[SOURCE]/[west,south,east,north]/[DAY_RANGE]/[YYYY-MM-DD]
FIRMS_BASE_URL = "https://firms.modaps.eosdis.nasa.gov"
FIRMS_MAX_DAY_RANGE = 5

# Sources relevant to Indonesia (LANDSAT_NRT is US/Canada only).
# *_SP = standard processing (archive), *_NRT = near real-time.
FIRMS_SOURCES = {
    "MODIS_SP": "MODIS",
    "MODIS_NRT": "MODIS",
    "VIIRS_SNPP_SP": "VIIRS",
    "VIIRS_SNPP_NRT": "VIIRS",
    "VIIRS_NOAA20_SP": "VIIRS",
    "VIIRS_NOAA20_NRT": "VIIRS",
    "VIIRS_NOAA21_SP": "VIIRS",
    "VIIRS_NOAA21_NRT": "VIIRS",
}

# Rough bounding box around Indonesia (west, south, east, north).
# It also covers parts of Malaysia, Brunei, Singapore, Timor-Leste, Papua New Guinea
# and the southern Philippines; clip to official boundaries before regional analysis.
INDONESIA_BBOX = (94.0, -11.5, 141.5, 6.5)

# Harmonization (lode/harmonization/cell-day-method.md): 0.01° grid, WIB calendar dates nationwide.
HARMONIZATION_GRID_DEG = 0.01
HARMONIZATION_TZ = "Asia/Jakarta"  # WIB, UTC+7, no DST

# Platform (individual satellite) per detection, so series can use a constellation that is
# consistent over time. VIIRS: from the FIRMS source. MODIS: from the `satellite` column
# (codes observed in SP data; NRT codes not yet verified).
PLATFORMS = ("terra", "aqua", "snpp", "noaa20", "noaa21")
VIIRS_PLATFORM_BY_SOURCE = {
    "VIIRS_SNPP_SP": "snpp",
    "VIIRS_SNPP_NRT": "snpp",
    "VIIRS_NOAA20_SP": "noaa20",
    "VIIRS_NOAA20_NRT": "noaa20",
    "VIIRS_NOAA21_SP": "noaa21",
    "VIIRS_NOAA21_NRT": "noaa21",
}
MODIS_PLATFORM_BY_SATELLITE = {"Terra": "terra", "Aqua": "aqua"}

# Archive sources. Required sources define coverage (a date is covered only if all of them cover
# it); optional ones contribute where available (they only affect the viirs_all series).
REQUIRED_SOURCES = ("MODIS_SP", "VIIRS_SNPP_SP")
OPTIONAL_SOURCES = ("VIIRS_NOAA20_SP", "VIIRS_NOAA21_SP")

# Province boundaries (verified 2026-10-21 via https://www.geoboundaries.org/api/current/gbOpen/IDN/ADM1/).
# 34 provinces as of 2017: predates the 2022 Papua splits (38 provinces today).
BOUNDARIES = {
    "path": RAW_DIR / "boundaries" / "geoBoundaries-IDN-ADM1_simplified.geojson",
    "name": "geoBoundaries gbOpen IDN ADM1 (simplified)",
    "source": "OpenStreetMap (Wambacher), via geoBoundaries",
    "license": "Open Data Commons Open Database License 1.0 (ODbL)",
    "year_represented": 2017,
    "url": "https://www.geoboundaries.org/",
    "id_field": "shapeISO",
    "name_field": "shapeName",
}


def firms_map_key() -> str:
    """Return the FIRMS MAP_KEY from the environment, or raise a clear error."""
    key = os.getenv("FIRMS_MAP_KEY", "").strip()
    if not key:
        raise RuntimeError(
            "FIRMS_MAP_KEY is not set. Copy .env.example to .env and add your key."
        )
    return key
