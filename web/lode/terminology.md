# Terminology

- karhutla - *kebakaran hutan dan lahan*, forest and land fires
- titik panas - hotspot; a satellite detection of a thermal anomaly, **not** a confirmed fire
- active cell-day (kept in English in the Bahasa UI too, until a better translation is agreed) - a 0.01° grid cell (~1.1 km) with at least one kept detection on a WIB calendar date; the only headline metric
- cell / dot - one 0.01° grid cell, drawn as a point at its centre; `cell_id` = `"{i}_{j}"` grid indices
- MODIS - Terra + Aqua sensor; series `modis`; colour `#2a78d6`
- VIIRS S-NPP - series `viirs_snpp`; consistent over time; colour `#eb6834`
- VIIRS all - series `viirs_all` (S-NPP + NOAA-20 + NOAA-21); jumps when the satellites are added; off by default and shown with a warning; dashed orange
- both sensors - MODIS and VIIRS on the same cell and date; colour `#1baf7a`
- complete / partial date - whether a WIB date is fully covered by the data pull; partial dates are shown as "partial", never as 0
- low_conf_only - a cell-day whose detections were all low confidence
- outside provinces - cell-days whose centre falls outside every province polygon (sea, coast, neighbouring countries), ~6.4%
- WIB / WITA / WIT - Indonesian time zones (UTC+7 / +8 / +9); dates use WIB nationwide
- SiPongi+ - the Ministry of Forestry's fire information platform; cite "SIPONGI KEMENHUT" if its data is used
- data product - a versioned static file exported by `../pipeline`; the only data source for this app
- manifest - `public/data/v1/manifest.json`; the index and provenance for every other file
- lode - this AI-maintained knowledge folder
