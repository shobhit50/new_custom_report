# Report Studio · Node.js MVC demo

This project is independent of the original Python files in the parent folder. The original template, schema, sample sources, configs, assets, and builder prototype were copied into `node_demo`; their originals remain untouched.

## Run

Requirements: Node.js 22+ and Google Chrome or Chromium for PNG generation. There are no npm packages to install.

```bash
cd node_demo
npm start
```

Open **http://127.0.0.1:3000/**. Set `PORT` for another port and `CHROME_BIN` if Chrome is installed in a different location.

1. On the first page, add platforms from cards and choose each source's level, dimensions, metrics and filters. The stream name comes from its platform and level; the connected account is supplied internally. Continue to **Combine sources** to browse 15 selectable platform combinations and their possible groupings, sourced from the root `source-first-config.json`. “Fields available” means the selected inputs contain those fields; it does not assert that metrics can safely be merged. Groupings that need mapping, more fields, or full metric coverage stay visible but cannot be applied until supported. Choosing an available option adds an editable relationship below. Each relationship can keep one source separate, append rows, match records, or align metrics; choose metric suppliers where needed. The 15 reference options are not 15 active outputs. Saved configs contain only the relationships the user added. The output plan shows configuration structure only; provider fetching and combination execution are not connected. Report periods and final row layout stay on the second page. The editable legacy example in `shared/source-config.example.json` is converted to combination cards when loaded.
2. The Report Builder page starts with the existing sample rows and values. Select a cell to see metrics from the chosen config. Empty preview values can bind to the selected sample dataset metric and date; filled preview values retain their original sample value.
3. Click **Generate PNG** to render the current builder state through the Node backend. A default builder is also available at `/builder` without creating a config.

First-page design previews: [choose platforms](design/source-setup-platforms.png) and [combine sources](design/source-setup-combinations.png).

Saved source plans and compatible sample metric selections live in `backend/data/configs/`. Builder edits remain in browser local storage, isolated by config ID. The first page uses a sample capability catalog in `shared/source-catalog.json`; provider fetching and combination execution are not connected yet. Its output preview shows configured relationships, not fetched values or match coverage. The second page continues to use sample datasets. Source JSON files are synthetic examples; no live provider API connection is included.

For the original batch pipeline in Node.js:

```bash
npm run dataset                       # write backend/data/datasets.json
npm run render                        # all four PNGs + combined report.png
npm run render -- --demo              # DSR sample PNG
npm run render -- --config backend/resources/configs/google_WOW.json
```

Batch PNGs are saved under `backend/data/output/`. The CLI supports `--data-dir`, `--dataset-output`, `--report-date` and `--png` options; `npm run dataset` supports `--data-dir` and `--output`. The Node `--demo` command uses the bundled DSR sample because the original project's `fixtures/fixtures_30.json` is absent.

## MVC layout

- `backend/src/models`: sample dataset loader, saved configs, and report config compiler.
- `backend/src/controllers`: config, dataset and report request handling.
- `backend/src/views`: unchanged report HTML template copy and its Node renderer.
- `backend/src/services`: schema validation, report calculations, HTML and Chrome PNG rendering.
- `backend/src/routes`: HTTP API mapping.
- `frontend/src/pages/config-builder`: first page.
- `frontend/src/pages/report-builder`: second page, copied from the existing prototype and wired to the backend.
- `frontend/src/models` and `frontend/src/controllers`: API client and builder integration.
- `shared`: copied frozen config schema and [API contract](shared/contracts/api.md).

The frontend and backend use the shared HTTP contract and can be handed to separate teams. The frontend has no import of backend source code; the backend has no import of frontend JavaScript.

## Verification

```bash
npm test
```

The tests compare all four bundled report configs against Python reference rows and headers. The copied sample sources produce the same five dataset IDs and rows. The Meta campaign adapter is checked separately. All four Node PNGs and the combined PNG were rendered with Chrome and compared with the existing PNGs: image dimensions and pixels matched exactly in the local macOS environment.
