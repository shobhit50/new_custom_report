import fs from 'node:fs';
import path from 'node:path';
import { resources } from './dataset.model.js';

export function listPresets() {
  return fs.readdirSync(path.join(resources, 'configs')).filter((name) => name.endsWith('.json')).map((name) => ({
    id: path.basename(name, '.json'), name: JSON.parse(fs.readFileSync(path.join(resources, 'configs', name), 'utf8')).template_name
  }));
}
export function getPreset(id) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid preset ID');
  const file = path.join(resources, 'configs', `${id}.json`);
  if (!fs.existsSync(file)) throw new Error('Preset not found');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
const sourceMap = { GA4: 'perf_ga4', 'Google Ads': 'perf_google', 'Meta Ads': 'perf_meta', 'Meta Ads B2B': 'b2b_meta', Shopify: 'perf_shopify' };
const metricMap = { Revenue: 'revenue', Spend: 'spend', Leads: 'leads' };
const formatMap = { 'Number · 2 decimals': { type: 'number', precision: 2 }, 'Currency · 2 decimals': { type: 'currency', precision: 2 }, Integer: { type: 'integer' }, Percent: { type: 'percent', precision: 2 }, Text: { type: 'text' } };
const slug = (value) => String(value).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100) || 'item';
function cellSpec(cell, period, key, selected, datasets) {
  const format = formatMap[cell.format] || { type: 'text' };
  if (cell.previewValue !== '' && cell.previewValue !== null && cell.previewValue !== undefined) {
    const text = String(cell.previewValue).replaceAll(',', '').replace(/^₹/, '').replace(/%$/, '');
    return { kind: 'literal', text, format: format.type === 'text' ? format : { type: format.type, precision: format.precision } };
  }
  const source = sourceMap[cell.source] || cell.source, metric = metricMap[cell.metric] || cell.metric;
  const allowed = selected?.some((item) => item.source === source && item.metric === metric);
  if (allowed && datasets[source]?.columns.includes(metric)) return { kind: 'actual', source, metric, aggregate: 'sum', period: key, format };
  return { kind: 'literal', text: '', format: { type: 'text' } };
}
export function stateToConfig(state, selected, datasets) {
  if (!state || typeof state !== 'object' || !Array.isArray(state.blocks) || !state.blocks.length) throw new Error('Invalid report builder state');
  const blocks = state.blocks.map((block, bi) => ({
    id: slug(block.id || `block_${bi + 1}`), title: String(block.title || ''), tables: (block.tables || []).map((table, ti) => {
      const periods = {}, periodKeys = [];
      (table.periods || []).forEach((period, pi) => {
        const key = `period_${pi + 1}`; periodKeys.push(key);
        periods[key] = { label: String(period.label || ''), start_date: period.start || 'report_date', end_date: period.end || 'report_date' };
      });
      const header = [[{ label: String(table.title || 'Report'), key: 'metric' }, ...periodKeys.map((key, pi) => ({ label: String(table.periods[pi].label || ''), key, period: key }))]];
      const rows = (table.rows || []).map((row, ri) => ({
        key: slug(row.id || `row_${ri + 1}`), style: row.total ? 'total' : 'normal',
        cells: [{ kind: 'literal', text: String(row.label || '') }, ...periodKeys.map((key, pi) => cellSpec(row.cells?.[pi] || {}, table.periods[pi], key, selected, datasets))]
      }));
      return { id: slug(table.id || `table_${ti + 1}`), periods, header, rows: { mode: 'static', data: rows } };
    })
  }));
  return { schema_version: 1, template_id: null, template_name: String(state.name || 'Report'), sources: {}, blocks };
}
