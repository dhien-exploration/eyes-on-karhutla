"""Chart and map preparation: labels, units, colours, missing-data display.

No scientific calculations belong here; inputs come from ``activity``.
Colours: categorical slots 1–3 of the validated reference palette (adjacent and
all-pairs CVD-safe); colour = sensor family, dash = different constellation.
Calendars use one sequential blue ramp, and each panel is titled with its series.
"""

from __future__ import annotations

import datetime as dt

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go

from eyes_on_karhutla import activity

METRIC_LABEL = "Active cell-days (0.01° cells with ≥1 detection)"
SERIES_COLOR = {"modis": "#2a78d6", "viirs_snpp": "#eb6834", "viirs_all": "#eb6834"}
SERIES_DASH = {"modis": "solid", "viirs_snpp": "solid", "viirs_all": "dot"}
AGREEMENT_COLOR = {"both": "#1baf7a", "a_only": "#2a78d6", "b_only": "#eb6834"}
SEQUENTIAL = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"]
WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def label(series: str) -> str:
    return activity.SERIES[series]["label"]


def agreement_labels(a: str, b: str) -> dict[str, str]:
    return {"both": "Both", "a_only": f"{label(a)} only", "b_only": f"{label(b)} only"}


def calendar_grid(daily: pd.DataFrame, series: str) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Weekday × week grid of one series: ``(values, hover_text)``.

    Partial WIB dates and dates outside the pull are NaN (shown blank), never 0.
    """
    d = pd.DataFrame({"date": pd.to_datetime(daily.index), "value": daily[series].astype(float)})
    d.loc[~daily["complete"].to_numpy(), "value"] = float("nan")
    d["weekday"] = d["date"].dt.weekday
    d["week"] = (d["date"] - pd.to_timedelta(d["weekday"], unit="D")).dt.date
    d["text"] = d["date"].dt.strftime("%a %d %b %Y") + "<br>" + d["value"].map(
        lambda v: "partial coverage" if pd.isna(v) else f"{int(v):,} active cell-days"
    )
    values = d.pivot(index="weekday", columns="week", values="value").reindex(range(7))
    text = d.pivot(index="weekday", columns="week", values="text").reindex(range(7)).fillna("outside pull range")
    return values, text


def calendar_figure(daily: pd.DataFrame, series: str) -> go.Figure:
    values, text = calendar_grid(daily, series)
    fig = go.Figure(go.Heatmap(
        z=values.to_numpy(), x=list(values.columns), y=WEEKDAYS, text=text.to_numpy(),
        hovertemplate="%{text}<extra></extra>", colorscale=SEQUENTIAL, xgap=2, ygap=2,
        colorbar=dict(title="cell-days", thickness=10),
    ))
    fig.update_layout(
        title=f"{label(series)}: active cell-days per WIB date", height=260,
        margin=dict(l=40, r=10, t=40, b=30), yaxis=dict(autorange="reversed"),
        xaxis=dict(title="week starting (Monday)", showgrid=False),
    )
    return fig


def series_figure(daily: pd.DataFrame, series: tuple[str, ...]) -> go.Figure:
    d = daily[daily["complete"]]
    fig = go.Figure()
    for s in series:
        fig.add_scatter(
            x=list(d.index), y=d[s], name=label(s), mode="lines",
            line=dict(color=SERIES_COLOR[s], dash=SERIES_DASH[s], width=2),
            hovertemplate="%{x|%d %b %Y}: %{y:,} cell-days<extra>" + label(s) + "</extra>",
        )
    fig.update_layout(
        title="Daily active cell-days, sensor series side by side (not summed)",
        yaxis_title=METRIC_LABEL, hovermode="x unified", height=360,
        legend=dict(orientation="h", y=-0.2), margin=dict(l=40, r=10, t=40, b=40),
    )
    return fig


def ratio_figure(ratio: pd.Series, numerator: str, denominator: str) -> go.Figure:
    median = ratio.median()
    fig = go.Figure(go.Scatter(
        x=list(ratio.index), y=ratio, mode="lines", line=dict(color=SERIES_COLOR[numerator], width=2),
        name="daily ratio", hovertemplate="%{x|%d %b %Y}: %{y:.1f}×<extra></extra>",
    ))
    fig.add_hline(y=median, line=dict(dash="dash", width=1), annotation_text=f"median {median:.1f}×",
                  annotation_position="top left")
    fig.update_layout(
        title=f"{label(numerator)} ÷ {label(denominator)} per day: not a constant factor",
        yaxis_title="ratio of active cell-days", height=300, showlegend=False,
        margin=dict(l=40, r=10, t=40, b=30),
    )
    return fig


def agreement_map(cell_days: pd.DataFrame, agreement: pd.Series, a: str, b: str) -> go.Figure:
    """Cell-centre points coloured by which series detected the cell-day."""
    names = agreement_labels(a, b)
    keep = agreement.notna()
    d = cell_days[keep].assign(
        lat=cell_days["cell_lat"] + 0.005, lon=cell_days["cell_lon"] + 0.005,
        detected_by=agreement[keep].map(names),
        low_conf_only=cell_days["low_conf_only"].map({True: "yes", False: "no"}),
    )
    fig = px.scatter_map(
        d, lat="lat", lon="lon", color="detected_by",
        color_discrete_map={names[k]: c for k, c in AGREEMENT_COLOR.items()},
        category_orders={"detected_by": list(names.values())},
        hover_data={"wib_date": True, "n_modis": True, "n_viirs": True, "low_conf_only": True,
                    "lat": ":.2f", "lon": ":.2f", "detected_by": False},
        labels={"wib_date": "WIB date", "n_modis": "MODIS detections",
                "n_viirs": "VIIRS detections (all satellites)", "low_conf_only": "low confidence only"},
        zoom=3.6, center={"lat": -2.0, "lon": 117.5}, height=560, map_style="carto-positron",
    )
    fig.update_traces(marker=dict(size=5, opacity=0.85))
    # Draw the smallest class ("Both") last so it is not hidden; keep the legend in the original order.
    fig.data = fig.data[::-1]
    fig.update_layout(margin=dict(l=0, r=0, t=0, b=0),
                      legend=dict(title="Detected by", y=0.98, x=0.01, traceorder="reversed"))
    return fig


def format_period_table(monthly: pd.DataFrame) -> pd.DataFrame:
    """Readable period table: series labels as columns, coverage as 'complete/total days'."""
    series = [c for c in monthly.columns if c in activity.SERIES]
    out = monthly[series].rename(columns={s: label(s) for s in series})
    out["Days covered"] = monthly["n_complete_days"].astype(str) + " / " + monthly["n_days"].astype(str)
    out.index = out.index.astype(str)
    return out


def date_range_text(start: dt.date, end: dt.date) -> str:
    return f"{start:%d %b %Y} – {end:%d %b %Y}"
