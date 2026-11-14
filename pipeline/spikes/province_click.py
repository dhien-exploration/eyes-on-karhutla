"""THROWAWAY SPIKE: can Streamlit + folium give a usable click-a-province map?

Run: uv run streamlit run spikes/province_click.py
Not part of the app. Region assignment here is a quick sjoin; if the spike succeeds,
it moves into a shared module with tests (see lode/plans/clickable-map.md).
"""

import time

import folium
import geopandas as gpd
import streamlit as st
from streamlit_folium import st_folium

from eyes_on_karhutla import activity, config, pipeline, visualization as viz

BOUNDARIES = config.RAW_DIR / "boundaries" / "geoBoundaries-IDN-ADM1_simplified.geojson"

st.set_page_config(page_title="Spike: province click", layout="wide")


@st.cache_data(show_spinner="Running pipeline…")
def load():
    result = pipeline.run_local()
    prov = gpd.read_file(BOUNDARIES)[["shapeName", "shapeISO", "geometry"]]
    cd = result.cell_days
    pts = gpd.GeoDataFrame(
        cd[["cell_lat", "cell_lon"]], geometry=gpd.points_from_xy(cd.cell_lon + 0.005, cd.cell_lat + 0.005), crs=4326
    )
    joined = gpd.sjoin(pts, prov, how="left", predicate="within")
    joined = joined[~joined.index.duplicated()]  # a point on a shared border could match twice
    cd = cd.assign(province=joined["shapeName"].reindex(cd.index))
    display = prov.copy()
    display["geometry"] = display.geometry.simplify(0.01, preserve_topology=True)
    totals = cd[cd.modis_hit].groupby("province").size()
    display["modis_cell_days"] = display.shapeName.map(totals).fillna(0).astype(int)
    return result, cd, display.to_json(), display.drop(columns="geometry"), display[["shapeName", "geometry"]]


t0 = time.perf_counter()
result, cd, display_json, prov_table, prov_geo = load()

st.title("Spike: click a province")
unassigned = cd["province"].isna().mean()
st.caption(f"{unassigned:.1%} of cell-days fall outside the simplified province shapes (sea, coast, other countries).")

left, right = st.columns([3, 2])
with left:
    m = folium.Map(location=[-2.5, 118], zoom_start=5, tiles="OpenStreetMap")
    folium.Choropleth(
        geo_data=display_json, data=prov_table, columns=["shapeName", "modis_cell_days"],
        key_on="feature.properties.shapeName", fill_color="Blues", fill_opacity=0.7, line_weight=0.5,
        legend_name="MODIS active cell-days, Aug–Oct 2019",
    ).add_to(m)
    folium.GeoJson(
        display_json, name="click layer",
        style_function=lambda f: {"fillOpacity": 0, "weight": 0},
        highlight_function=lambda f: {"weight": 2, "color": "#0b0b0b"},
        tooltip=folium.GeoJsonTooltip(fields=["shapeName"], aliases=["Province"]),
    ).add_to(m)
    # Selected-province outline goes in a dynamic layer, so the base map is not rebuilt (keeps zoom).
    selected = folium.FeatureGroup(name="selected")
    if st.session_state.get("province"):
        folium.GeoJson(
            prov_geo[prov_geo.shapeName == st.session_state["province"]].to_json(),
            style_function=lambda f: {"fillOpacity": 0, "weight": 3, "color": "#eb6834"},
        ).add_to(selected)
    out = st_folium(m, key="map", height=560, use_container_width=True, feature_group_to_add=selected,
                    returned_objects=["last_active_drawing"])

clicked = (out or {}).get("last_active_drawing")
if clicked and clicked["properties"].get("shapeName") != st.session_state.get("province"):
    st.session_state["province"] = clicked["properties"]["shapeName"]
    st.rerun()
name = st.session_state.get("province")

with right:
    if not name:
        st.info("Click a province on the map.")
    else:
        sub = cd[cd["province"] == name]
        daily = activity.daily_series(sub, result.utc_start, result.utc_end)
        st.subheader(name)
        st.metric("MODIS active cell-days", f"{int(daily.loc[daily.complete, 'modis'].sum()):,}")
        st.plotly_chart(viz.series_figure(daily, activity.DEFAULT_SERIES), width="stretch")
        st.plotly_chart(viz.calendar_figure(daily, "viirs_snpp"), width="stretch")

st.caption(f"Script run: {time.perf_counter() - t0:.2f} s. Boundaries: geoBoundaries (OSM, ODbL 1.0), 34 provinces (2017).")
