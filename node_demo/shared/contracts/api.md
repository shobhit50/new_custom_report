# Frontend–backend contract

The frontend can be moved to another repository. Set `window.REPORT_STUDIO_API_BASE` before loading its modules and configure `FRONTEND_ORIGIN` on the backend if the origins differ.

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/datasets/catalog` | GET | Dataset IDs, metrics, dimensions from sample sources |
| `/api/source-config/catalog` | GET | Sample platform capabilities and editable source-config example for the first page |
| `/api/configs` | GET | Saved metric selection configs |
| `/api/configs` | POST | Save `{name, selections:[{source,metric}], sourceConfig?}`; `sourceConfig` stores the first-page source plan |
| `/api/configs/:id` | GET | Load selected config on builder page |
| `/api/reports/presets` | GET | Bundled report config names |
| `/api/reports/presets/:id` | GET | Bundled frozen-schema report config |
| `/api/reports/preview` | POST | Accept `{state, configId?, reportDate?}` or `{config, reportDate?}`, return `{html}` |
| `/api/reports/png` | POST | Same input as preview; return `image/png` |

`state` is the existing builder page's browser state. The backend converts it to the unchanged `config.schema.json` contract before rendering. Nonempty preview values stay literal to preserve the original sample. A blank value with an allowed source/metric uses the sample dataset and selected date period.

The selected metric config controls which new source/metric choices appear in the builder. Existing sample cells and values remain visible.
