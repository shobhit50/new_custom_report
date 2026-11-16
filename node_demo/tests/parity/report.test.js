import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDatasets, normalizeMetaCampaignDaily } from '../../backend/src/models/dataset.model.js';
import { compileReport } from '../../backend/src/services/report-engine.js';
import { renderHtml } from '../../backend/src/services/report-renderer.js';
import { stateToConfig } from '../../backend/src/models/report.model.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const expected = JSON.parse(fs.readFileSync(path.join(root, 'tests/parity/expected.json'), 'utf8'));
const datasets = buildDatasets();
const summary = (blocks) => blocks.map((block) => ({ title: block.title, tables: block.tables.map((table) => ({
  header: table.header.map((line) => line.map((cell) => ({ label: cell.label, rowspan: cell.rowspan, colspan: cell.colspan }))),
  rows: table.rows.map((row) => ({ key: row.key, style: row.style, cells: row.cells.map((cell) => cell.display) }))
})) }));

test('copied sources produce the original five datasets', () => {
  const original = JSON.parse(fs.readFileSync(path.join(root, 'tests/parity/expected-datasets.json'), 'utf8'));
  assert.deepEqual(datasets, original);
});
test('all bundled configs match Python reference rows and headers', () => {
  for (const [name, reference] of Object.entries(expected)) {
    const config = JSON.parse(fs.readFileSync(path.join(root, 'backend/resources/configs', `${name}.json`), 'utf8'));
    assert.deepEqual(summary(compileReport(config, datasets, '2026-10-13').blocks), reference, name);
    const html = renderHtml(config, datasets, { baseUrl: 'http://127.0.0.1:3000' });
    assert.match(html, /Powered by/);
    assert.match(html, /<table class="dataframe">/);
  }
});
test('invalid config is rejected before rendering', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'backend/resources/configs/simple_tabular.json'), 'utf8'));
  config.blocks[0].layout = 'absolute';
  assert.throws(() => compileReport(config, datasets, '2026-10-13'), /Schema error|layout/);
});
test('builder state preserves preview values and binds selected blank metrics', () => {
  const state = { name: 'Demo', blocks: [{ id: 'block-1', title: 'Metrics', tables: [{ id: 'table-1', title: 'Daily', periods: [{ label: '12 Oct', start: '2026-10-12', end: '2026-10-12' }], rows: [
    { id: 'row-1', label: 'Sample', cells: [{ source: 'GA4', metric: 'Revenue', previewValue: '7,011.12', format: 'Number · 2 decimals' }] },
    { id: 'row-2', label: 'Live sample', cells: [{ source: 'GA4', metric: 'Revenue', previewValue: '', format: 'Number · 2 decimals' }] }
  ] }] }] };
  const config = stateToConfig(state, [{ source: 'perf_ga4', metric: 'revenue' }], datasets);
  const compiled = compileReport(config, datasets, '2026-10-13');
  assert.equal(compiled.blocks[0].tables[0].rows[0].cells[1].display, '7,011.12');
  assert.equal(config.blocks[0].tables[0].rows.data[1].cells[1].kind, 'actual');
  assert.notEqual(compiled.blocks[0].tables[0].rows[1].cells[1].display, '-');
});
test('Meta campaign adapter preserves IDs and rejects duplicate grain', () => {
  const raw = { date_start: '2026-10-12', campaign_id: 123, campaign_name: 'Launch', spend: '0', impressions: '10', inline_link_clicks: '2' };
  const result = normalizeMetaCampaignDaily([raw], { accountId: 'act_1' });
  assert.deepEqual(result.grain, ['date', 'account_id', 'campaign_id']);
  assert.equal(result.rows[0].campaign_id, '123');
  assert.equal(result.rows[0].spend, 0);
  assert.equal(result.rows[0].link_clicks, 2);
  assert.throws(() => normalizeMetaCampaignDaily([raw, raw], { accountId: 'act_1' }), /duplicate campaign\/day\/account grain/);
  assert.throws(() => normalizeMetaCampaignDaily([{ ...raw, spend: 'NaN' }], { accountId: 'act_1' }), /Invalid spend/);
});
