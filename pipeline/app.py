"""Streamlit entry point. UI and orchestration only; logic lives in src/eyes_on_karhutla/."""

import datetime as dt

import streamlit as st

from eyes_on_karhutla import activity, pipeline, visualization as viz

st.set_page_config(page_title="Eyes on Karhutla", layout="wide")


@st.cache_data(show_spinner="Harmonizing MODIS and VIIRS detections…")
def load(exclude_low_confidence: bool) -> pipeline.Result:
    return pipeline.run_local(exclude_low_confidence=exclude_low_confidence)


# ---- Sidebar ---------------------------------------------------------------
with st.sidebar:
    st.header("Options")
    show_all_viirs = st.checkbox(
        "Also show VIIRS all satellites",
        help="Adds NOAA-20. Not consistent over time: the series jumps when NOAA-20 starts (2018).",
    )
    exclude_low = st.checkbox(
        "Exclude low-confidence detections",
        help="Sensitivity check. Default keeps all levels; MODIS and VIIRS confidence scales differ.",
    )
    st.caption("Region: Indonesia bounding box (not yet clipped to national borders).")

try:
    result = load(exclude_low)
except (FileNotFoundError, ValueError) as err:
    st.error(f"Could not load local FIRMS data: {err}")
    st.stop()

series = activity.DEFAULT_SERIES + (("viirs_all",) if show_all_viirs else ())
daily, cell_days = result.daily, result.cell_days
complete = daily[daily["complete"]]

# ---- Header ----------------------------------------------------------------
st.title("Eyes on Karhutla")
st.markdown(
    "**Harmonized MODIS–VIIRS burning activity for Indonesia.** "
    f"WIB dates {viz.date_range_text(complete.index.min(), complete.index.max())}. "
    "Hotspots are satellite *thermal-anomaly detections*, not confirmed fires."
)
if exclude_low:
    st.warning("Sensitivity mode: low-confidence detections are excluded.")

agreement = activity.sensor_agreement(cell_days)
modis_cd = int(complete["modis"].sum())
cols = st.columns(4)
cols[0].metric("Complete WIB dates", f"{len(complete)}")
cols[1].metric(f"{viz.label('modis')} active cell-days", f"{modis_cd:,}")
cols[2].metric(f"{viz.label('viirs_snpp')} active cell-days", f"{int(complete['viirs_snpp'].sum()):,}")
cols[3].metric("Same-cell agreement", f"{(agreement == 'both').sum() / max(modis_cd, 1):.0%}",
               help="Share of MODIS cell-days that VIIRS S-NPP also detected in the same 0.01° cell and WIB date. "
                    "Neighbouring-cell matches are not counted, so this understates agreement.")

tab_cal, tab_map, tab_method = st.tabs(["Activity calendar", "Map", "Method & data quality"])

# ---- Calendar --------------------------------------------------------------
with tab_cal:
    st.caption(
        f"Metric: **{viz.METRIC_LABEL}**, per WIB date. Each sensor is its own series with its own "
        "colour scale; they are **never added together**. Blank cells are partial-coverage dates."
    )
    for s in series:
        st.plotly_chart(viz.calendar_figure(daily, s), width="stretch")
    st.plotly_chart(viz.series_figure(daily, series), width="stretch")

    left, right = st.columns([3, 2])
    with left:
        ratio = activity.series_ratio(daily, "viirs_snpp", "modis")
        st.plotly_chart(viz.ratio_figure(ratio, "viirs_snpp", "modis"), width="stretch")
        st.caption(
            "VIIRS detects more active cell-days mainly because it is more sensitive to small and cool fires. "
            "The ratio changes from day to day, so no single conversion factor turns one sensor into the other."
        )
    with right:
        st.subheader("Monthly totals")
        st.dataframe(viz.format_period_table(activity.aggregate(daily[["complete", *series]], "M")), width="stretch")
        st.caption("Sums of complete WIB dates only. 'Days covered' shows partial months.")

# ---- Map -------------------------------------------------------------------
with tab_map:
    dates = list(complete.index)
    peak = complete["modis"].idxmax()
    start, end = st.select_slider(
        "WIB date range (up to 7 days)", options=dates, value=(peak, peak),
        format_func=lambda d: d.strftime("%d %b %Y"),
    )
    if (end - start) > dt.timedelta(days=6):
        st.warning("Showing the first 7 days of the selected range to keep the map responsive.")
        end = start + dt.timedelta(days=6)
    in_range = cell_days["wib_date"].between(start, end)
    st.caption(
        f"{in_range.sum():,} cell-days. Colour shows which series detected each 0.01° cell. "
        "‘Only’ often means a neighbouring cell was hit by the other sensor, or the other sensor missed a small fire."
    )
    st.plotly_chart(
        viz.agreement_map(cell_days[in_range], agreement[in_range], "modis", "viirs_snpp"),
        width="stretch",
    )

# ---- Method & data quality -------------------------------------------------
with tab_method:
    st.subheader("How the harmonization works")
    st.markdown(
        """
1. **Ingest** NASA FIRMS standard-processing archives: MODIS (Terra, Aqua) and VIIRS 375 m (S-NPP, NOAA-20).
2. **Normalize** to one schema and keep every original field. Invalid rows are set aside with a reason, never dropped silently.
3. **Filter** to FIRMS `type = 0` (presumed vegetation fire). Volcanoes, static industrial sources and offshore detections are excluded.
4. **Snap** each detection to a **0.01° cell (~1.1 km)** and a **WIB calendar date**.
5. **Collapse** to *active cell-days*: one row per cell and date, with flags for which satellites saw it.
   Repeat detections in a cell no longer add up, but VIIRS still records about 3× as many cell-days as
   MODIS (S-NPP alone; about 5.5× with NOAA-20), because it is more sensitive. That is why the two are never summed.
6. **Report** fixed-constellation series side by side: MODIS (Terra + Aqua) and VIIRS S-NPP (constant since 2012).

**What an active cell-day is not:** a fire count, burned area or fire intensity.
"""
    )
    st.subheader("Data sources and provenance")
    st.dataframe(result.provenance, width="stretch", hide_index=True)
    st.subheader("Exclusions")
    st.dataframe(
        result.excluded.groupby(["source", "exclusion_reason"]).size().rename("rows").reset_index(),
        width="stretch", hide_index=True,
    )
    st.subheader("Coverage")
    partial = daily[~daily["complete"]].index
    st.markdown(
        f"UTC pull: {viz.date_range_text(result.utc_start, result.utc_end)}. "
        f"Partial WIB dates (excluded from totals): {', '.join(d.strftime('%d %b %Y') for d in partial)}. "
        f"Low-confidence-only cell-days: {cell_days['low_conf_only'].mean():.1%}."
    )
    st.subheader("Known limitations")
    st.markdown(
        """
- One fire season (Aug–Oct 2019) so far. There are no multi-year baselines or anomalies yet.
- The region is a bounding box: it includes parts of Malaysia, Brunei, Timor-Leste and Papua New Guinea.
- WIB is used nationwide, so some late-night detections in WITA/WIT fall on a different local date.
- Same-cell agreement at 0.01° understates true agreement. For MODIS vs all VIIRS satellites in 2019 it is 57% in the same cell but 85% within the neighbouring cells.
- MODIS and VIIRS confidence classes have the same names but are not equivalent.
"""
    )
    st.caption(
        "Data: NASA FIRMS (MODIS Collection 6.1, VIIRS 375 m), https://firms.modaps.eosdis.nasa.gov/."
    )
