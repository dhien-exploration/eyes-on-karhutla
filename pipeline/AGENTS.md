# AGENTS.md — Eyes on Karhutla

## 1. Project Overview

We are building a Python-based application for the **harmonization of MODIS and VIIRS hot spots**.

The project focuses on Indonesian forest and land fires (*kebakaran hutan dan lahan*, or *karhutla*).

Our goal is to turn satellite fire observations into understandable, comparable, and actionable information about historical fire activity.

The application should help users:
- Explore historical fire activity geographically.
- Understand seasonal and recurring burning patterns.
- Compare observations from NASA's MODIS and VIIRS instruments.
- Identify periods or locations with unusual fire activity.
- Interpret the limitations and uncertainty of satellite-derived observations.

The central technical goal is **harmonizing MODIS and VIIRS observations into a consistent historical burning activity calendar**, not simply displaying hotspot points on a map.

## 2. Existing Indonesian System: SiPongi+

### 2.1 What SiPongi+ Is

SiPongi+ is an Indonesian government forest and land fire information platform managed by the Ministry of Forestry (Kementerian Kehutanan).

Official website:
- Map: https://sipongi.gakkum.kehutanan.go.id/peta
- Hotspot distribution and data downloads: https://sipongi.gakkum.kehutanan.go.id/sebaran-titik-panas

SiPongi+ is an existing system for monitoring and exploring hotspot information. It already provides functionality such as:
- Displaying hotspot locations on a map.
- Filtering observations by time period, province, satellite, and confidence level.
- Displaying information about hotspot observations.
- Providing hotspot distribution summaries and graphs.
- Offering data downloads in supported formats.
- Displaying related forest-fire information, including other available indicators.

The platform displays observations associated with satellite sources such as TERRA/AQUA, SNPP, and NOAA-20. Its interface also exposes confidence categories and fire-danger information.

**Important:** These are known capabilities from the publicly reviewed SiPongi+ pages. Do not assume that every capability is available for every date, sensor, dataset, or geographic area. Revisit the official platform when verifying specific features.

### 2.2 Why SiPongi+ Matters to Our Project

SiPongi+ is an existing solution that overlaps with our initial concept of a national hotspot map with location details, filters, historical graphs, and downloadable data.

Therefore, a project that only:
- Displays Indonesian hotspots on a map.
- Lets users click a hotspot to view its details.
- Filters hotspots by date or province.
- Adds ordinary historical charts.

may offer insufficient differentiation unless we demonstrate a meaningful improvement or a specific unmet need.

We must not describe these basic features as unique innovations without validating that claim.

### 2.3 Our Intended Differentiation

Our project should investigate and demonstrate the value of **cross-sensor harmonization and historical fire-activity analysis**.

Potential differentiators include:

1. **Burning Activity Calendar**
   - Present fire activity across days, weeks, months, and years.
   - Help users identify seasonal patterns and recurring critical periods.
   - Allow users to inspect historical activity for a selected region.

2. **MODIS–VIIRS Harmonization**
   - Establish a documented method for combining or comparing observations from both sensor families.
   - Account for differences in spatial resolution, detection characteristics, acquisition times, and data availability.
   - Explain how harmonization affects the resulting activity metrics.
   - Preserve the original sensor and source information for traceability.

3. **Historical Anomaly Analysis**
   - Compare current or selected-period activity with an appropriate historical baseline.
   - Highlight unusual activity using transparent, documented methods.
   - Distinguish an unusual observation count from a confirmed increase in burned area or fire severity.

4. **Transparent Data Quality**
   - Show data coverage, missing periods, sensor provenance, processing assumptions, and relevant uncertainty.
   - Allow users to distinguish raw observations from derived or harmonized metrics.

These are proposed areas of differentiation, not claims that SiPongi+ lacks these capabilities. **The agent must verify the actual gap before asserting that a feature is new.**

### 2.4 Mandatory SiPongi+ Research Workflow

Before implementing major features, the agent must:

1. Review the official SiPongi+ map, hotspot distribution page, graphs, and available documentation.
2. Record the capabilities that are directly verified.
3. Investigate available filters, historical coverage, downloadable data, and sensor information relevant to the proposed application.
4. Compare those findings against this project's goals (section 1).
5. Maintain a concise feature comparison describing:
   - What SiPongi+ demonstrably provides.
   - What our application plans to provide.
   - What remains unknown.
   - Why the proposed difference matters to users.
6. Recommend building only the features needed to demonstrate our project's specific value.

Do not assume that a feature is absent merely because it is not immediately visible in the interface. If its availability cannot be verified, mark it as **unknown**.

Do not spend effort rebuilding the entire SiPongi+ platform. Prioritize a small, convincing demonstration of MODIS–VIIRS harmonization and historical activity analysis.

### 2.5 Data Sources and Attribution

Prefer NASA FIRMS and other authoritative NASA sources for obtaining the satellite observations this project needs.

Relevant starting point:
- NASA FIRMS: https://firms.modaps.eosdis.nasa.gov/

Use official SiPongi+ data when it serves a clear validation or comparison purpose, and only through permitted access methods.

The SiPongi+ hotspot distribution page states that data sourced from its website must cite SIPONGI KEMENHUT. Follow the applicable attribution and usage requirements whenever its data is used.

Do not assume that SiPongi+ data and NASA FIRMS data are identical, independent, or directly interchangeable. Investigate their source, processing, timing, and coverage before using them together.

## 3. Technical Stack

Use Python as the primary language for data exploration, processing, harmonization, and the web application.

### Core tools

- **Python:** Main programming language.
- **JupyterLab:** Explore datasets, investigate sensor characteristics, experiment with processing methods, and validate results.
- **pandas:** Tabular data manipulation.
- **NumPy:** Numerical calculations where useful.
- **GeoPandas:** Geographic data processing.
- **Shapely:** Geometry operations when needed.
- **Streamlit:** Interactive web application.
- **Plotly:** Interactive charts and historical activity visualizations.
- **Folium or an appropriate mapping library:** Interactive geographic maps.
- **pytest:** Tests for reusable processing and harmonization logic.

Optional tools should be introduced only when justified:
- PostgreSQL/PostGIS for persistent storage and spatial queries.
- HTTP clients for retrieving remote data.
- Additional geospatial or visualization libraries when the requirements justify them.

Do not introduce a complex backend, frontend framework, or infrastructure layer unless it solves a concrete problem.

## 4. Project Structure

Prefer a structure similar to:

```text
pipeline/
├── AGENTS.md
├── README.md
├── pyproject.toml
├── app.py
├── notebooks/
│   ├── 01_explore_nasa_data.ipynb
│   ├── 02_compare_modis_viirs.ipynb
│   └── 03_validate_harmonization.ipynb
├── src/
│   └── eyes_on_karhutla/
│       ├── __init__.py
│       ├── config.py
│       ├── ingestion.py
│       ├── preprocessing.py
│       ├── harmonization.py
│       ├── activity.py
│       └── visualization.py
├── tests/
│   ├── test_preprocessing.py
│   ├── test_harmonization.py
│   └── test_activity.py
└── data/
    ├── raw/
    └── processed/
```

Adjust this structure when necessary, but keep exploratory work, reusable application logic, tests, and data organized.

Do not commit large datasets, credentials, API tokens, or other secrets to version control.

## 5. Core Logic Must Be Shared Between JupyterLab and Streamlit

### 5.1 The Principle

JupyterLab is the research environment. Streamlit is the user-facing application.

However, they must use the same reusable processing code.

**Never implement the only copy of important business or scientific logic inside a notebook or directly inside Streamlit UI code.**

Use this architecture:

```text
NASA / permitted data sources
              |
              v
        ingestion.py
              |
              v
      preprocessing.py
              |
              v
      harmonization.py
              |
              v
         activity.py
           /     \
          v       v
    JupyterLab  Streamlit
     research    web app
```

Both environments should import functions from `src/eyes_on_karhutla/`.

### 5.2 JupyterLab Responsibilities

Use notebooks to:
- Inspect the structure and quality of source datasets.
- Explore MODIS and VIIRS fields, time ranges, and spatial coverage.
- Investigate duplicate or overlapping observations.
- Experiment with preprocessing and harmonization approaches.
- Compare results before and after processing.
- Generate exploratory charts and maps.
- Document assumptions, experiments, limitations, and conclusions.

Notebooks should call shared functions rather than repeatedly reimplementing processing steps.

When an experiment produces reusable, validated logic, move that logic into the appropriate Python module and import it back into the notebook.

### 5.3 Streamlit Responsibilities

The Streamlit application should:
- Provide the user interface for the selected region and date range.
- Call the same shared functions used in JupyterLab.
- Display maps, activity calendars, charts, and explanatory information.
- Cache expensive computations when appropriate.
- Report missing data and processing errors clearly.
- Avoid exposing raw implementation details unnecessarily.

Keep Streamlit code focused on interface and orchestration, rather than embedding scientific algorithms in UI callbacks.

### 5.4 Development Workflow

Use the following iterative process:

1. Inspect a real dataset in JupyterLab.
2. Form a specific hypothesis or processing requirement.
3. Implement reusable logic in `src/eyes_on_karhutla/`.
4. Test it with representative and edge-case inputs.
5. Import the function into JupyterLab and validate its behavior.
6. Update the Streamlit interface to use the same function.
7. Compare the application output with the notebook's validated output.
8. Document the result and its limitations.

Do not wait until all research is complete before creating the Streamlit application. Build a minimal interface early, then improve it as the data pipeline becomes more reliable.

## 6. Module Responsibilities

### `ingestion.py`

Responsible for:
- Loading supported NASA FIRMS datasets and other explicitly approved sources.
- Handling file formats and source-specific field names.
- Preserving source metadata and provenance.
- Reporting invalid, empty, or incomplete input.

Avoid embedding application-specific UI logic here.

### `preprocessing.py`

Responsible for:
- Normalizing column names and data types.
- Parsing acquisition dates and timestamps.
- Validating coordinates and required fields.
- Standardizing sensor identifiers without losing the original values.
- Handling invalid records and documenting exclusions.

Do not silently discard records or alter source values without a documented reason.

### `harmonization.py`

Responsible for:
- Implementing the documented MODIS–VIIRS harmonization method.
- Handling sensor-specific differences.
- Defining any spatial or temporal aggregation rules.
- Managing overlapping detections without automatically treating them as independent fires.
- Recording assumptions, limitations, and relevant uncertainty.

Do not simply concatenate MODIS and VIIRS records and claim the result is harmonized.

Do not assume that detections from different sensors correspond one-to-one with individual fires.

### `activity.py`

Responsible for:
- Aggregating observations into daily, weekly, monthly, or other defined activity periods.
- Producing regional time series and calendar-ready datasets.
- Supporting historical baseline comparisons.
- Calculating documented anomaly indicators where appropriate.
- Preserving enough metadata to explain the results.

Clearly distinguish observation counts, estimated fire activity, fire radiative power, burned area, and other metrics. They are not interchangeable.

### `visualization.py`

Responsible for:
- Preparing processed data for maps and charts.
- Applying consistent labels and units.
- Supporting visual comparisons of raw and harmonized metrics.
- Making missing data and uncertainty visible where relevant.

Avoid placing scientific calculations exclusively in visualization code.

## 7. Data Contracts and Scientific Integrity

Use a documented internal schema for normalized observations. Example fields may include:

- `latitude`
- `longitude`
- `acq_datetime`
- `sensor`
- `confidence`
- `frp`
- `source`
- `source_record_id`

Include additional fields when required by the source or analysis. Define units, nullability, and semantics in documentation.

Preserve original source fields where practical.

### Scientific requirements

- Treat satellite hotspot records as detections of thermal anomalies, not as confirmed fire incidents.
- Account for differences between MODIS and VIIRS rather than assuming their records are directly comparable.
- Preserve the acquisition time and sensor identity.
- Document spatial and temporal aggregation choices.
- Validate the effects of harmonization using suitable test cases and overlapping observations.
- Make missing coverage and uncertainty visible.
- Avoid claims about burned area, fire severity, or individual fire incidents unless the data and method support them.
- Do not claim that an anomaly predicts a future fire without a validated predictive method.
- Distinguish data-processing correctness from real-world validation.

If the scientific basis for a proposed metric is unclear, investigate and document it before presenting it as an established result.

## 8. Application Priorities

Implement features in this order unless project goals or data findings justify a change.

### Priority 1: Reliable data foundation
- Obtain a representative MODIS and VIIRS dataset.
- Document the source, fields, coverage, and limitations.
- Build ingestion and preprocessing functions.
- Produce repeatable, tested processing outputs.

### Priority 2: Demonstrable harmonization
- Implement a defensible initial harmonization method.
- Compare source observations with the harmonized results.
- Explain the method and its limitations.
- Validate the method with representative cases.

### Priority 3: Historical Burning Activity Calendar
- Aggregate activity across a defined time range.
- Allow exploration of a selected region.
- Display seasonal and historical patterns.
- Explain which metric the calendar represents.

### Priority 4: Interactive Streamlit application
- Add a map and date or regional filters.
- Display the calendar, supporting charts, and relevant source information.
- Provide a clear explanation of harmonization.
- Make it possible for a first-time visitor to understand the value of the application quickly.

### Priority 5: Anomaly analysis and additional features
- Add historical comparisons when the available data supports them.
- Consider downloadable results and additional analytical views.
- Consider notifications only if the core deliverable is already working and time remains.

## 9. Notifications and Public Safety

The original concept included notifying residents near fire activity.

Treat this as a possible future extension, not the initial core deliverable.

Before implementing notifications:
- Identify the intended recipient and decision-making workflow.
- Establish a reliable alert threshold and suitable validation.
- Consider satellite observation latency and false positives.
- Avoid presenting a hotspot as a confirmed emergency.
- Use consent-based notification mechanisms or authorized public warning infrastructure.
- Do not assume that location-based alerts can reach arbitrary residents without their participation or appropriate institutional access.

Any alert must clearly communicate its source, observation time, uncertainty, and recommended next steps.

## 10. AI Agent Working Rules

When contributing to this repository, the AI agent must:

1. Read this file before making significant changes.
2. Inspect the existing project structure and code before proposing replacements.
3. Research SiPongi+ before claiming that a proposed feature is unique or missing from existing Indonesian systems.
4. Keep confirmed facts, assumptions, and unknowns separate.
5. Prefer the smallest implementation that demonstrates the project's central value.
6. Reuse shared Python modules across JupyterLab and Streamlit.
7. Write tests for reusable processing logic, particularly harmonization and aggregation.
8. Use representative real data where available, and clearly label synthetic data used for development.
9. Avoid inventing dataset fields, sensor capabilities, API endpoints, or scientific conclusions.
10. Document external data sources and attribution requirements.
11. Explain significant scientific or architectural decisions in plain language.
12. Avoid unnecessary abstractions, dependencies, and infrastructure.
13. Preserve data provenance and make processing reproducible.
14. Run relevant tests and report any tests or validation steps that could not be completed.
15. Never claim that a feature, analysis, or validation is complete unless it has actually been implemented and checked.

## 11. Definition of Done

A feature is complete when:
- Its purpose and expected behavior are clear.
- Its core logic is reusable where appropriate.
- Relevant tests pass.
- Its output has been checked against representative inputs.
- Scientific assumptions and limitations are documented.
- The Streamlit interface displays the result correctly when applicable.
- Data provenance and required attribution are preserved.
- Any claims about differentiation from SiPongi+ are supported by actual research.

The project succeeds when it demonstrates, with a working and explainable prototype, how harmonized MODIS and VIIRS observations can provide a more consistent view of historical burning activity—not merely when it displays hotspots on a map.

## 12. Lode Coding Method
You are responsible for managing project knowledge using the Lode Coding method.

Lode Coding: all persistent project memory lives in a structured, AI-owned markdown repository called the Lode at lode/. The Lode is the AI's perfect memory and the only way to stay aligned over weeks/months.

Core principles you never break
• The human owns the code and makes final decisions. You are the memory and high-speed executor.
• Anything worth implementing is worth permanently recording in the Lode.
• The Lode is for YOU (the AI). Summarize lode contents rather than dumping them verbatim, unless the user requests a specific file by path.

Authority inside lode/
• You may freely create, update, rename, move, or delete files.
• You may create new top-level directories when the project evolves.
• You may delete a file only if it exists in the repo and has no uncommitted changes.
• All diagrams must be Mermaid only.
• If lode content contradicts actual code, summarize the disparity, prioritize the code as the source of truth, and ask the user to confirm your suggested lode fix.

Mandatory structure (create missing parts as needed)
lode/
    summary.md               # one-paragraph living snapshot
    terminology.md           # a repository of short (term - meaning) lines describing the domain language
    practices.md             # patterns and practices relevant to this project
    lode-map.md              # hierarchical index of all lode files
    plans/                   # roadmaps & TODOs
    tmp/                     # git-ignored session scraps
    [any-domain]/            # e.g. parser/, auth/, ui/, billing/
        summary.md + *.md    # one focused topic per file (kebab-case)

Every lode file must
• cover exactly one topic
• contain concrete code examples + Mermaid diagrams
• link to related lodes with relative paths
• document invariants, contracts, rationale, and lessons learned
• stay under 250 lines; if larger, decompose into focused sub-files

Mandatory workflow (gently enforce)
1. Seed sessions with the most relevant lode files.
2. Use chat mode for exploration and design; never jump straight to code.
3. Implement only after a clear decision.
4. The instant the user says "looks good / ship it / this is final", immediately update or create the corresponding lode entries so the Lode reflects reality.
5. After big changes, check if lode structure still mirrors the codebase and refactor if needed.

Recurring nudges you should use naturally
- "Let's capture this design in lode/... before implementing."
- "Per Lode Coding, chat-mode first, then agent-mode."
- "Now that this is settled, I'll update the lode so we never forget."

Important Behaviours
- Session scraps go in lode/tmp/ (git-ignored)
- Only permanent learnings go in main lode files
- If you're documenting something you'll need in future sessions, it goes in the lode
- If it's just 'how I solved today's problem,' it stays in chat
- information in the lode is a description of the current state of the system. Do not leave behind summaries of completed work. Instead, update the lode appropriately.
- your performance over time is determined by the quality of your code and the Lode.
- after completing any user request that modifies code behavior or structure, immediately update the corresponding lode file before moving to the next task.
- your success is measured by lode accuracy after each session: the lode must reflect current system state, not a history of changes.

Example - Lode entry after adding retry logic to API client:

BAD (changelog style):
  "Added retry logic to api-client.ts on 2024-01-15. Previously requests
   would fail immediately. Now they retry 3 times with exponential backoff."

GOOD (current state):
  "The API client retries failed requests up to 3 times with exponential
   backoff (100ms, 200ms, 400ms). Retries apply only to 5xx and network
   errors; 4xx responses fail immediately."

If you need to capture changelog-style information, save it in lode/tmp/.

Session handovers
When the user requests a handover, create a handover document in lode/tmp/. This document should provide all relevant knowledge from the current session that will be useful when resuming in a fresh session, including: current task state, decisions made, approaches tried, blockers encountered, and next steps. The goal is to let a fresh session continue seamlessly without losing momentum.

At session start, read lode/lode-map.md, lode/terminology.md, and lode/summary.md.

IMPORTANT: Before exploring the codebase or searching for files, ALWAYS check lode/lode-map.md first. It's your index to all project documentation. Use it to find relevant lode files before diving into code.

When the session starts, briefly show that you have domain knowledge before attending to the first request.

if the lode/ does not exist, ask the user if you should create one.

## 13. Architecture Direction and Future Vision

### 13.1 Decision: Public Web Front End Is a Separate JavaScript Project

Decided by the project owner on 2026-10-21.

- The **public, user-facing web application** is a separate JavaScript package (`web/` in the same monorepo, `eyes-on-karhutla`), built around an interactive map (MapLibre GL JS). It reads pre-computed data products and contains no scientific processing.
- Both packages live in one monorepo: this Python package in `pipeline/`, the web app in `web/`. The package boundary still separates science (here) from presentation (there).
- **This package stays Python** and is the **internal tool and the scientific source of truth**:
  - ingestion, preprocessing, harmonization and activity logic in `src/eyes_on_karhutla/`
  - JupyterLab research and validation
  - **exporting versioned data products** for the web front end (province shapes, per-province series, cell-level detection histories, coverage and provenance metadata)
  - the Streamlit app, as an **internal analysis and validation tool**, not the public product
- Reason: the intended experience (Indonesia-only map, hover and select provinces, fly-in to a province with detection dots, per-dot and per-province histories, rich and possibly gamified UI, public contributions) does not fit Streamlit's server-rerun model.
- Where this section conflicts with the Streamlit-as-web-app wording in sections 3, 5.3, 8 and 11, **this section wins for the public product**. Those sections still apply to the internal Streamlit tool.

Rules that follow from this:
- Never move scientific logic into the JavaScript package (`web/`). If the front end needs a new metric, add it here with tests and export it.
- Exported data products are a **contract**. They have a documented schema, a schema version, stable identifiers (province ID, cell ID), units, provenance and attribution. Breaking changes need a new schema version.
- Exports must carry the same scientific labels used here: "active cell-days", the separate MODIS and VIIRS series (never summed), partial-coverage flags, and "detections, not confirmed fires".

### 13.2 Vision: Community Platform (Future)

Over time, the project owner intends the site to grow into an open, community-driven movement:
- Anyone can contribute **code or data** to the repositories.
- **Local residents** affected by fires can select a detection dot or province and submit a situation update.
- **Remote contributors** can attach findings from social media to a dot or province.
- **No submission is shown immediately.** Every submission enters a moderation queue, and an admin reviews it before it becomes public.

Invariants for any future community feature:
- No user submission is public without admin approval.
- Community reports are a **separate, clearly labelled layer** ("community report, unverified"). They never alter satellite-derived metrics in this repository.
- Admin approval means "meets publishing guidelines", **not** "verified as true", and the interface must say so.
- The platform is not an emergency channel. It must direct people to official emergency and disaster channels (see section 9).
- Each published report records its source (and link for social-media findings), observation time, submission time, approver and approval time.
- Protect contributors and residents: collect minimal personal data, do not publicly expose exact home locations, blur identifiable people in media, and follow Indonesian personal data protection law (requirements to be verified).
- Prepare publishing guidelines for reports that blame identifiable people or organizations, and seek legal advice before launch.
- For social-media findings, store links and short summaries, not copies of others' content.

This vision does not change the current priorities (section 8). MODIS–VIIRS harmonization and historical activity remain the core deliverable. Current designs should only avoid blocking the vision, for example by using stable identifiers and keeping satellite and community data in separate layers.

Details and open questions are maintained in `lode/plans/vision-community.md`.
