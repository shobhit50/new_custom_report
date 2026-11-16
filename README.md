# Custom report local test project

`Python_render.py` runs this pipeline:

`Data_Source/*.json` → `Data_Set/datasets.json` → combine with every
`template_config/*.json` → `report_template.html` (in memory) → one PNG per
config in `output/`. No report HTML files are saved.

`build_dataset.py` is the separate normalization stage. The renderer writes
the dataset file, then reads that saved file to compile the report.
The report engine, fixture set, schema, template shell, and logos are copied into
this project so it does not depend on files in Downloads or Account Weaver.

## Run

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python Python_render.py
```

The default command renders every JSON config in `template_config/`. Each gets
`output/<config-name>.png`; `output/report.png` combines all images.
The intermediate registry is
`Data_Set/datasets.json`.
To build only the intermediate dataset, run `python build_dataset.py`.
Use `python Python_render.py --config template_config/google_WOW.json` to
render only one config, or `python Python_render.py --demo` for the bundled fixture
report. Run
`python Python_render.py --help` for date, config, dataset directory, and
output path options.

PNG generation follows Account Weaver's `imgkit` + `wkhtmltoimage` path when
the executable is installed. On macOS, Google Chrome is the fallback.
The Chrome path captures up to a 3000-pixel-high viewport; unusually long
reports should use `wkhtmltoimage`.

## Data contract

`Data_Source` contains exactly four platform files: `google_ads.json`,
`meta_ads.json`, `ga4.json`, and `shopify.json`. Their current values are
**synthetic sample rows**, dated October 2026; they are not live API data.
Replace them with platform rows before checking real numbers. Each source file
contains `platform` and `rows`:

```json
{
  "platform": "google_ads",
  "rows": [{"segment": "google", "date": "2026-10-12", "spend": 100}]
}
```

The local builder validates source grain and writes five stable dataset IDs:
`perf_meta`, `b2b_meta`, `perf_google`, `perf_ga4`, and `perf_shopify`.
Meta's sample `report_scope` is used only to create the two Meta datasets;
the view config binds to those dataset IDs. Duplicate source grain is rejected
and no aggregation or join is inferred. Extra source fields are omitted by this
sample adapter. Google spend comes from
Google Ads, Facebook spend and B2B leads from Meta, attributed revenue from
GA4, and Shopify revenue from Shopify. Meta rows use `report_scope` values
`performance` and `b2b` so the two Meta report sections remain separate.
The GA4 sample's `segment` values are pre-assigned; this is not a verified
attribution mapping for real GA4 responses. Provider API payloads must be
normalized before these datasets can be used. No API fetch, credentials,
account authorization, generic dataset configuration, or cross-platform join
is implemented here. The proposed DatasetDefinition in the agent handoff is
research guidance, not an active JSON contract.

`normalize_meta_campaign_daily` is a separate, tested first adapter for rows
from the inspected Meta campaign/daily connector. It maps `date_start`,
`campaign_id`, `spend`, `impressions` and `inline_link_clicks`, with account ID
supplied by a trusted caller. It is not wired to live fetching.

## DSR image reference

`template_config/dsr_reference.json` uses the frozen schema to reproduce the
DSR.jpg table. The image's seven base metric rows are static literals in the
config because the current Data_Set does not contain all those metrics/dates.
Calculated rows (conversion rate, total spend, CPT, CAC, ROI and AOV) use
formulas in the same config. This verifies schema, formulas and image rendering;
it does not verify live source bindings for the missing DSR metrics.

The default renderer includes this config in its batch. To render only DSR:

```bash
python Python_render.py --config template_config/dsr_reference.json
```

`template_config/summary_reference.json` reproduces the 13-column channel
summary in `sumery.jpg` using static values transcribed from the image. It
checks grouped headers, total rows and PNG layout against the frozen schema;
the current Data_Set does not supply all of these historical metrics. Run
`python Python_render.py --config template_config/summary_reference.json` for
its PNG, or run the default command to include it with every config.

## Verification

The default run generated PNGs for all configs. The 30 bundled research fixture
configs were previously checked through the template. See `logs/verification.log`.
No existing `.log` files were found in Account Weaver; this local verification
log records the tests run here.
