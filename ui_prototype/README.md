# Report Studio design prototype

Open `report_builder.html` in a desktop browser. This is a functional local UX prototype, not the production builder. It does not write config files or call `Python_render.py`.

## Try the flow

1. Select **Table · Daily summary** in Structure. Its settings appear on the right and the table is outlined on the canvas.
2. Click a value, such as **Revenue / 13 Oct**. The selected cell is highlighted, its path is shown above the canvas, and its source, metric, period and format appear on the right.
3. Change the table title, a row label, or a period label. The report canvas updates immediately.
4. Click **Add block**, then **Add table** while the new block is selected. The original sample remains in place, and the new block and table appear below it.
5. Click **Add row** in the new table. It receives a blank cell for every existing period. Select its cell and enter a **Preview value** to see it on the canvas.
6. Click **Add cell / column** from a row or cell. A new period column and a blank cell in every row keep the table aligned. Rename the period and edit the new cell.
7. Refresh the browser. The draft survives in browser local storage. Use **Reset sample** to restore the original report.
8. Click **Show issue** to inspect the missing-data state. The affected value is highlighted and the inspector presents recovery choices. PNG generation is disabled while the issue is shown.

The original numbers are illustrative values from the DSR reference image/config. New values you enter are local preview data. The prototype saves only to this browser's local storage; **Generate PNG** still demonstrates the intended action and does not call the renderer.

## Front-end mapping

| UI object | Existing frozen config path |
| --- | --- |
| Report | `template_name`, `blocks[]` |
| Block | `blocks[].id`, `type`, `title`, `tables[]` |
| Table | `blocks[].tables[]` |
| Date columns | `tables[].periods` and `tables[].header` |
| Rows | `tables[].rows` |
| Selected cell | `tables[].rows.data[].cells[]` |
| Cell source and metric | `cells[].source`, `metric`, `period`, `kind`, `format` |

The product flow should keep structure, selected object, editing controls and rendered result visible together. The UI can offer plain-language controls, while its eventual compiler must validate and emit the existing `config.schema.json`. Source choices should come from the actual `Data_Set` registry. Do not imply live account connections: this local project currently uses sample JSON files, and the DSR/summary reference configs include static screenshot values.
