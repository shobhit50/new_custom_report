# Report Studio — research continuation and completion plan

Status date: 2026-11-16. This document picks up from the last recorded state
(`logs/verification.log`, `node_demo/README.md`, `source-first-config.json`).
Everything in **Part A** is derived from files in this folder; **Part B** is new
analysis; **Part C** is the proposed completion plan. Items marked
**OPEN DECISION** need a product/engineering call.

---

## Part A — What was already decided and built

### A1. Overall pipeline (as built)

```
Step 1: Source Builder ──► source config (saved JSON)          [validated, NOT executed]
                                   ╳  (no link today)
Data_Source/*.json ──► build_dataset (hardcoded) ──► 5 datasets {columns, grain, rows}
                                                          │
Step 2: Template Builder ──► browser state ──► stateToConfig ──► config.schema.json (v1)
                                                          │
                                   report engine (Python ≡ Node, parity-tested)
                                                          │
                       report_template.html (in memory) ──► PNG (wkhtmltoimage / Chrome)
```

Two implementations exist: the Python research project (root) and
`node_demo/` (Node 22, no npm deps, MVC, frontend/backend split by
`shared/contracts/api.md`). `npm test`: 11/11 pass (re-run 2026-11-16). Node PNGs
are pixel-identical to the Python PNGs.

### A2. Source Builder (Step 1) — finalized configuration

UI: `node_demo/frontend/src/pages/config-builder/` (designs in `node_demo/design/`).
Validator: `node_demo/backend/src/models/source-config.model.js`.
Catalog: `node_demo/shared/source-catalog.json`. Reference options: `source-first-config.json`.

**Sub-step 1 — Choose platforms**
- Config name + breakdown (`day | week | month`).
- Platform cards (Google Ads, Meta Ads, GA4, Shopify). A platform can be added
  more than once to create separate filtered **streams** (e.g. `ga4_google`, `ga4_meta`).
- Per stream: data level (from catalog), dimensions, metrics, filters.
- Rules enforced:
  - Stream name is derived from platform + level; `input.label` is rejected.
  - `account_refs` come from the catalog; the account is supplied internally, the user doesn't type it.
  - `date` is a mandatory dimension.
  - Filters: only the `in` operator, at most 8 per stream, and only on the stream's selected dimensions.
  - At most 12 inputs.
- GA4 presets: All traffic, Google paid (`google / cpc`, `google/cpc`), Meta paid
  (`meta / metaads`, `facebook / paid`), Custom. Separate filtered GA4 streams are
  the decided way to give Google and Meta their own GA4 numbers.

**Sub-step 2 — Combine sources** (finalized format = `combinations[]`)

```json
{ "contract_version": 1, "breakdown": "day",
  "inputs": [ {"id","platform","account_refs","level","dimensions","metrics","filters?"} ],
  "combinations": [ {"id","label","operation","inputs","keys","join_type",
                     "group_by","traffic_scope","metric_sources"} ] }
```

| Operation | Inputs | Required settings | Output dimensions |
|---|---|---|---|
| `independent` | exactly 1 | — | the source's dimensions |
| `append` | 2–12 | — | `source` + dims shared by all |
| `match` | exactly 2 | `keys` (1–8 left/right pairs), `join_type` left/inner/full, supplier for every metric | left keys |
| `align` | 2–12 | `group_by` ⊆ shared dims, supplier for every metric | `group_by` |

- Both sides of a match are aggregated on the match keys before matching.
- A combination may use an earlier combination as an input (chaining).
- Every GA4 input that has `source_medium` needs a `traffic_scope` (`all` or
  `values`). The values must be a subset of that input's Step 1 filter.
- Warnings: a date-only match loses campaign detail. All-GA4 traffic next to paid media is flagged.
- The 15 platform-subset options in `source-first-config.json` are **reference
  guidance, not active outputs**. Groupings are tagged `current | conditional |
  extended`, with `metric_coverage` `all | source_separated | partial`.
  - Only `current` groupings with non-`partial` coverage can be applied.
  - Exception: the Google Ads ↔ GA4 campaign-ID match can also be applied.
- Data-integrity principles (from the verification log):
  - No implicit aggregation or join; duplicate grain is rejected.
  - Campaign IDs from different platforms are never equivalent.
  - GA4 revenue and Shopify revenue are never added together by default.
  - A name-based grouping is a category only.
- Saved as `{id, name, selections[], sourceConfig, createdAt}` in `backend/data/configs/`.
  The legacy `merges/composition/grouping` shape is upgraded to `combinations` on load.
- **Explicitly not built:** provider fetching, auth, combination execution, a generic DatasetDefinition.

### A3. Template Builder (Step 2) — finalized configuration

**Frozen contract: `config.schema.json` (schema_version 1, "Universal Report Layout V5")**
- Root: `schema_version`, `template_id`, `template_name`, `sources` (free object), `blocks[]`.
- `blocks[]` (≤40, type `pivot`) → `tables[]` (≤30). Each table has:
  - `periods`: `{key: {label, start_date, end_date}}`. Date tokens: ISO date, `report_date`, `month_start(report_date)`, `year_start(report_date)`.
  - `header[][]`: up to 8 header rows, `rowspan`/`colspan`. Header cells bind `source/metric/segment/period`; `repeat` is by `values` (dataset field) or `days` (period).
  - `rows`: `static` or `dynamic` (`source` + `row_key`, row templates with `repeat:"records"`, `sort`, `limit`), `style` normal/total, `where` filters.
  - `cells`: one of four kinds.
    - `literal`: `text`
    - `field`: a value from the current record
    - `actual`: `source` + `metric` + `aggregate` sum/avg/min/max/count/none
    - `calculated`: `formula`
  - Cell `format`: text/integer/number/currency/percent, precision 0–6.
- Formula language (AST-whitelisted, no code execution):
  - Functions: `METRIC`, `FIELD`, `CELL(row,col)`, `DIV`, `SUM`, `COALESCE`, `ABS`.
  - Operators: `+ - * /`.
  - Limits: ≤512 chars, ≤80 nodes, depth ≤20. Cycle detection.
- Frozen layout:
  - Blocks and tables stack vertically.
  - No placement or layout keys.
  - No body-cell merges.
- Limits: 2000 rows, 120 columns, 150k cells, 366 days in a daily repeat.
- Dataset contract consumed by the engine: `{columns[], grain[], rows[]}`. Grain must be unique and non-null.
- Rendering: one shared `report_template.html`.
  - Inputs: `rendered_report`, `heading`, `colour_code` (top_header / text_colour / row_index_colour), `template_images` (LF logo, client logo/name, platform logos, weavr logo), `footer_text`.
  - Output: PNG only; HTML is never saved.
- Proven by reproduction: `dsr_reference`, `summary_reference`, `google_WOW`, `simple_tabular`. The DSR and summary values are static literals transcribed from images.

**Builder UX (prototype, `report-builder/`)**
- Layout: three panes — Structure tree | Canvas | Inspector.
- Hierarchy: Report → Block → Table → Periods / Rows → Cell.
- Adding a row creates a cell for every period. Adding a column adds a cell to every row, so tables stay aligned.
- The selected cell's path is shown. A missing-data "issue" state disables PNG generation.
- Draft is kept in localStorage per config ID.
- The UI must offer plain-language controls but **compile to the frozen schema**.
- Source choices must come from the real dataset registry.

---

## Part B — Gap analysis (where the research paused)

### B1. The two builders are not connected (critical)
- `report.model.js` / `report_builder.js` hardcode `sourceMap`
  (`GA4→perf_ga4` …) and `metricMap`.
- `sampleSelections()` maps a saved source config down to `{source, metric}`
  pairs against the five fixed sample datasets.
- No code reads `sourceConfig.inputs/combinations` when rendering, so the
  combinations a user designs in Step 1 never reach a report.
- What is missing is a **combination executor**: it takes the source config
  plus fetched rows and produces datasets keyed by input/combination ID, in the
  engine's `{columns, grain, rows}` contract.

### B2. Templates are not reusable over time or across users
- Every reference config uses fixed dates (`2026-10-01`, `2026-10-12`), and
  header labels are static (`"MTD - October'26"`).
- The period grammar lacks previous day, previous month, week-to-date and offsets.
- `account_refs` in source configs are concrete accounts (`demo_google_account`).
  A template saved by user A therefore cannot run on user B's accounts.
- `template_id` is always `null`, `sources` is always `{}`, and there is no
  versioning, ownership, sharing or server-side persistence. Builder drafts live
  only in the browser.

### B3. The Template Builder emits only a subset of the schema
`stateToConfig` produces one header row, static rows, and literal/actual cells.
It does not support:
- calculated cells: the formula is kept only as a "description" and is never compiled;
- grouped or multi-row headers;
- dynamic (repeat-records) rows;
- `where` / segment filters;
- `repeat` columns.

Also, a non-empty "preview value" is compiled as a **literal**, which is
prototype behaviour that would freeze numbers into a template. So the engine can
render `summary_reference`, but a user cannot build it in the UI.

### B4. Executor semantics not yet specified
- **Additivity.** Pre-match aggregation and `align` sum metrics, but the catalog
  has no additivity flag. Ratios such as CTR or ROAS must be recomputed, not summed.
- **Lost attributes.** A `match` output keeps only the left keys, so display
  attributes (e.g. `campaign_name`) are lost.
- **Joins.** `full` join is allowed but its key coalescing is undefined.
  Post-aggregation one-to-one cardinality is assumed but not stated.
- **Append collisions.** Both GA4 and Shopify supply `sessions`/`revenue`.
  Disambiguation via the `source` column is the implied rule but is not documented.
- **Breakdown.** `breakdown` week/month is collected but unused; the engine aggregates daily rows into periods.
- **`segment`.** The engine treats `segment` as special, but the new source catalog has no `segment` dimension.
- **Filter matching.** GA4 preset spellings differ between the catalog and the example
  (`Meta / MetaAds` vs `meta / metaads`). Filter execution must be case/space-insensitive,
  matching the validator.

### B5. Output formats
- **Excel is absent** from this project.
- Account Weaver builds a flat openpyxl sheet. Its PNG path writes that Excel,
  reads it back with `pd.read_excel`, then renders HTML (`send_report`,
  `creative_custom_reports.py:14726`, roughly 14863–15054).
- So today PNG and Excel cannot represent grouped headers or totals identically.
- Presentation is hardcoded: ₹ currency, 3 colours, logos.

### B6. Account Weaver dependencies to replace (verified 2026-11-16)
Paths are in `lyxel-tech/account-weaver`, file `weaver/handlers/creative_custom_reports.py`.
- **`build_v2` dict** (:10219): 21 hardcoded report types → builder methods. Unknown types fall back to `_build_custom_report_v2`.
- **Metrics mappers:** one hardcoded `*_metrics_mapper` per report (:383–2400).
- **Combo checks:** platform-combination checks in `_validate_request_v2` (:14001).
- **Fetch branches:** per-report-type branches inside each fetcher (`_fetch_meta_v2` :9753, `_fetch_ads_v2` :9972, `_fetch_ga4_v2` :10030, `_fetch_shopify_v2` :10134).
- **Hardcoded joins:** e.g. GA4 UTM matching (:9316–9351).
- **Formulas:** Python closures inside each builder.
- **HTML branches:** report-specific `if`s in `creative_custom_report.html`.

Reusable as-is:
- `API_REGISTRY_V2` + `_fetch_with_retry_v2` (generic HTTP source layer)
- `SafeFormulaEvaluator` (`custom_metric.py:42`)
- `PlatformMetric` catalog (`creative_model.py:522`)
- `CreativeBrands.accounts` (account binding)
- `CreativeReports` schedule fields
- the Celery hourly scheduler
- Gmail / WhatsApp delivery

---

## Part C — Finalized approach to complete the system

### C1. Principle
Developers write code **once per connector level**, never per report. Everything
report-specific is data. The engine, renderer and exporters are generic and
already exist, apart from the executor and Excel.

### C2. Four artifacts

| # | Artifact | Owner | Contents | Changes per new report? |
|---|---|---|---|---|
| 1 | **Connector catalog** | Developers (rare) | platform → levels → fields; each field typed (dimension/metric, number/currency/text, `additive: true/false`, unit); fetch binding (API_REGISTRY_V2 endpoint + response→field mapping) | No |
| 2 | **Source config** (Step 1) | User | existing `contract_version 1` format, plus account **slots** instead of concrete accounts | No code |
| 3 | **Layout config** (Step 2) | User | frozen `config.schema.json` v1, unchanged | No code |
| 4 | **Template record** | System | wraps 2+3 with identity, presentation, versioning and sharing (C4) | No code |

Keeping presentation and identity in a **wrapper** means the frozen schema
(`additionalProperties: false` at root) does not need to change.

### C3. Step 1 → Step 2 contract (closes B1)
- Every input ID and combination ID becomes a **dataset ID**.
- The source config statically yields, per dataset ID, `{columns, grain, metric types}`.
  `referenceSpec()` already computes most of this.
- The Template Builder's Source/Metric dropdowns come **only** from that
  manifest. `sourceMap`/`metricMap` are deleted.
- Layout cells reference `source: "<dataset id>"`, `metric: "<column>"`.
- The executor yields the same IDs at run time with rows. Because the static
  manifest and the executed output share one definition, a template can be
  validated before any data is fetched.

Executor rules to adopt:
- Additive metrics are summed. Non-additive metrics are forbidden as inputs to
  pre-aggregation; derive them in the template with `DIV`.
- `match` output = keys + carried display attributes (e.g. `campaign_name`,
  declared as attribute-of-key in the catalog) + supplied metrics. Duplicate keys
  after aggregation → error.
- `full` join coalesces keys: left value, else right value.
- `append` adds a `source` column (input ID); grain = `source` + shared dims.
- `align` = per-input group-by on `group_by`, then a full outer join on `group_by`.
- Filters compare trimmed, lower-cased values.
- `breakdown` = fetch granularity. Templates still define their own periods;
  the engine may reject periods finer than the breakdown.
- `segment`: new templates use `where` on real dimensions. `segment` stays for backward compatibility only.

### C4. Template record (closes B2)

```json
{
  "template_id": "uuid", "version": 3, "status": "draft|published|archived",
  "owner_id": "...", "visibility": "private|org|public",
  "name": "Daily Performance", "description": "...",
  "source_config": { "contract_version": 1, "breakdown": "day",
     "account_slots": [{"slot": "google_ads_main", "platform": "google_ads"}],
     "inputs": [{"id": "google", "platform": "google_ads", "account_slot": "google_ads_main", "...": "..."}],
     "combinations": [ ... ] },
  "layout": { "schema_version": 1, "template_id": "uuid", "...": "frozen schema" },
  "presentation": { "colour_code": {...}, "currency": "INR", "locale": "en-IN",
                    "logos": {"client": "brand"}, "footer_text": "", "heading": "{template_name} - {report_date:%d %b %Y}" },
  "outputs": ["png", "xlsx"],
  "dataset_manifest": { "google": {"columns": [...], "grain": [...]} }
}
```

- **Reuse by another user:** pick template → bind each `account_slot` to an
  account of their brand (`CreativeBrands.accounts`) → validate that each slot's
  platform/level is supported by that account → run.
- The layout is never copied or edited, so the output structure is identical.
  "Customize" = fork into a new template with its own owner and version.
- Published versions are immutable. Schedules pin `template_id` + `version`, or
  opt into "latest".
- **Relative dates.** The `start_date`/`end_date` fields are free strings in the
  schema, so this is an engine-only change: add
  `report_date±Nd`, `week_start(...)`, `month_start/end(...)±Nm`, `year_start(...)`.
  Add period-aware label substitution, e.g. `"MTD - {period.mtd.start:%B'%y}"`.
  Implement it identically in the Python and Node engines and extend the parity tests.
- The builder must offer **only** relative tokens by default. Fixed dates are an
  explicit "pin this date" choice.

### C5. Template Builder completion (closes B3)
The builder must cover the full schema in plain language:
- **Header designer:** column groups → `colspan`/`rowspan`. Period groups expand to metric sub-columns, as in `summary_reference`.
- **Row modes:** fixed rows (static) and "one row per value of <dimension>" (dynamic, with `row_key`, sort, limit).
- **Cell kinds:** Data (actual), Text (literal), Record field, Formula.
- **Formula editor:** insert cell references (`CELL(row,col)`) and functions, with live validation via `/api/reports/preview`.
- **Total rows** as calculated `SUM(CELL…)` presets.
- **Filters per row/cell:** `where`, with values offered from the dataset's dimension values.
- **Preview** renders with the selected sample or real dataset. Preview values are never saved as literals.
- **Server persistence:** `POST/PUT /api/templates`, versions, a publish action, and a template gallery.

### C6. Exports (closes B5)
Both formats are rendered from the **same compiled `rendered_report`**:
- **PNG:** the existing HTML template plus wkhtmltoimage/Chrome.
- **XLSX:** a generic writer.
  - Header rows become merged cells, using the same rowspan/colspan occupancy grid as `expand_headers`.
  - Values are written as **numbers**, with an Excel `numFmt` derived from `format`: currency symbol from `presentation.currency`, precision, percent.
  - Total rows use the bold/fill style and colours from `presentation.colour_code`.
  - One worksheet per block, or blocks stacked with a title row (template option).
  - Python: openpyxl, already used in Account Weaver. Node: ExcelJS.
- PNG stops reading back the Excel file.
- Add an export parity test: every PNG cell's display string equals the XLSX cell rendered with its numFmt.

### C7. Account Weaver integration (removes developer dependency)
1. **Templates storage.** New Mongo collection `ReportTemplate` (C4). `CreativeReports` gains `template_id`, `template_version` and `account_bindings`. Existing scheduling and delivery fields are kept.
2. **One report type.** Add a single new `report_type: "template"` to `build_v2`. It runs: `TemplateRunner` → connector fetch (catalog bindings through `API_REGISTRY_V2`) → combination executor → engine → PNG + XLSX → existing `send_report` delivery.
3. **Migration.** Express the 21 legacy report types as published templates one by one. Accept each only after a parity test against current output, as was done for DSR and summary. Then retire the matching builder method and mapper.
4. **Metrics catalog.** `PlatformMetric` becomes the seed for the connector catalog's field list. Custom metrics (`CustomMetric` formulas) map to template formulas or catalog-derived fields.

### C8. OPEN DECISIONS (need an owner's call)
1. **Production engine language.**
   - Python inside Account Weaver: reuses fetch layer, openpyxl, imgkit and Celery.
   - Node service: the newer `node_demo` MVC track.
   - Both engines are parity-tested today. **Recommendation:** Python engine inside Account Weaver for fetching, execution and export, with the Node engine kept as the builder's in-browser/preview engine and the parity suite as the conformance gate.
2. **Template visibility model:** org-only vs cross-brand public gallery. Also who may publish.
3. **Excel layout:** one sheet per block, or a single stacked sheet.
4. **Should the schema get a v2?** Possible additions are conditional formatting, column widths and charts. Everything in this plan fits v1 plus the wrapper. A v2 is only needed for new visual features.
5. **Attribution mappings** marked `conditional/extended` (channel mapping, Shopify UTM): build a user-editable mapping table now, or defer.

### C9. Implementation order
| Phase | Deliverable | Exit test |
|---|---|---|
| 1 | Connector catalog v2 (types, additivity, attributes) + static dataset manifest from source config | manifest unit tests; builder dropdowns driven by manifest |
| 2 | Combination executor (independent/append/match/align, chaining) | fixture tests per operation incl. duplicate-key, full-join, non-additive rejection |
| 3 | Relative period tokens + label tokens in both engines | parity tests across 3 report dates |
| 4 | Template record + API (CRUD, versions, publish, fork, account-slot binding) | save → reload → render identical |
| 5 | Builder: header designer, dynamic rows, formulas, filters; remove literal preview compile | rebuild `summary_reference` entirely in UI |
| 6 | XLSX exporter + PNG/XLSX parity | export parity test on all 4 reference configs |
| 7 | Live connectors via API_REGISTRY_V2 (Meta campaign/day adapter already exists) | sandbox account run |
| 8 | Account Weaver `report_type: "template"` + scheduler + migrate legacy reports | per-report parity vs legacy output |
