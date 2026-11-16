import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const resources = fileURLToPath(new URL('../../resources/', import.meta.url));
const sourceSpec = {
  google_ads: { columns: ['segment', 'date', 'spend'], grain: ['segment', 'date'], numeric: ['spend'] },
  meta_ads: { columns: ['segment', 'date', 'report_scope', 'spend', 'leads'], grain: ['segment', 'date', 'report_scope'], numeric: ['spend', 'leads'] },
  ga4: { columns: ['segment', 'date', 'revenue'], grain: ['segment', 'date'], numeric: ['revenue'] },
  shopify: { columns: ['segment', 'date', 'revenue'], grain: ['segment', 'date'], numeric: ['revenue'] }
};

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function number(value, field) {
  if (value === null) return null;
  if (typeof value === 'boolean' || value === '' || !Number.isFinite(Number(value))) throw new Error(`Invalid ${field}`);
  return Number(value);
}
function source(name, dataDir) {
  const spec = sourceSpec[name];
  const input = JSON.parse(fs.readFileSync(path.join(dataDir, `${name}.json`), 'utf8'));
  if (input.platform !== name || !Array.isArray(input.rows)) throw new Error(`Invalid source ${name}`);
  const seen = new Set();
  const rows = input.rows.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || spec.columns.some((field) => !(field in raw))) throw new Error(`${name} row ${index + 1}: missing field`);
    const row = Object.fromEntries(spec.columns.map((field) => [field, raw[field]]));
    if (!validDate(row.date)) throw new Error(`${name} row ${index + 1}: invalid date`);
    if (spec.grain.some((field) => row[field] === null || row[field] === '')) throw new Error(`${name} row ${index + 1}: empty grain`);
    const key = JSON.stringify(spec.grain.map((field) => row[field]));
    if (seen.has(key)) throw new Error(`${name} row ${index + 1}: duplicate grain`);
    seen.add(key);
    for (const field of spec.numeric) row[field] = number(row[field], field);
    return row;
  });
  return { columns: spec.columns, grain: spec.grain, rows };
}
function dataset(input, columns, grain, scope) {
  const rows = input.rows.filter((row) => !scope || row.report_scope === scope).map((row) => Object.fromEntries(columns.map((field) => [field, row[field]])));
  const seen = new Set();
  for (const row of rows) {
    const key = JSON.stringify(grain.map((field) => row[field]));
    if (seen.has(key)) throw new Error('Derived dataset has duplicate grain');
    seen.add(key);
  }
  return { columns, grain, rows };
}
export function buildDatasets(dataDir = path.join(resources, 'data-sources')) {
  const actual = fs.readdirSync(dataDir).filter((name) => name.endsWith('.json')).map((name) => path.basename(name, '.json')).sort();
  if (JSON.stringify(actual) !== JSON.stringify(Object.keys(sourceSpec).sort())) throw new Error('Data source files mismatch');
  const meta = source('meta_ads', dataDir), google = source('google_ads', dataDir), ga4 = source('ga4', dataDir), shopify = source('shopify', dataDir);
  return {
    perf_meta: dataset(meta, ['segment', 'date', 'spend'], ['segment', 'date'], 'performance'),
    b2b_meta: dataset(meta, ['segment', 'date', 'spend', 'leads'], ['segment', 'date'], 'b2b'),
    perf_google: dataset(google, ['segment', 'date', 'spend'], ['segment', 'date']),
    perf_ga4: dataset(ga4, ['segment', 'date', 'revenue'], ['segment', 'date']),
    perf_shopify: dataset(shopify, ['segment', 'date', 'revenue'], ['segment', 'date'])
  };
}
export function metricCatalog(datasets = buildDatasets()) {
  return Object.entries(datasets).map(([id, ds]) => ({ id, metrics: ds.columns.filter((field) => !ds.grain.includes(field)), dimensions: ds.columns.filter((field) => ds.grain.includes(field)) }));
}
export function writeDatasets(dataDir, output) {
  const datasets = buildDatasets(dataDir);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const temporary = `${output}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(datasets, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, output);
  return datasets;
}
export function normalizeMetaCampaignDaily(rawRows, { accountId } = {}) {
  if (typeof accountId !== 'string' || !accountId.trim()) throw new Error('A trusted nonempty account_id is required');
  if (!Array.isArray(rawRows)) throw new Error('Meta campaign daily response must be a rows array');
  const seen = new Set();
  const rows = rawRows.map((raw, index) => {
    const required = ['date_start', 'campaign_id', 'campaign_name', 'spend', 'impressions', 'inline_link_clicks'];
    if (!raw || typeof raw !== 'object' || required.some((field) => !(field in raw))) throw new Error(`Meta row ${index + 1}: missing required connector fields`);
    if (!validDate(raw.date_start)) throw new Error(`Meta row ${index + 1}: invalid date_start`);
    const campaignId = String(raw.campaign_id ?? '').trim();
    if (!campaignId) throw new Error(`Meta row ${index + 1}: missing campaign_id`);
    const identity = JSON.stringify([raw.date_start, accountId, campaignId]);
    if (seen.has(identity)) throw new Error(`Meta row ${index + 1}: duplicate campaign/day/account grain`);
    seen.add(identity);
    return { date: raw.date_start, account_id: accountId, campaign_id: campaignId, campaign_name: String(raw.campaign_name), spend: number(raw.spend, 'spend'), impressions: number(raw.impressions, 'impressions'), link_clicks: number(raw.inline_link_clicks, 'link_clicks') };
  });
  return { columns: ['date', 'account_id', 'campaign_id', 'campaign_name', 'spend', 'impressions', 'link_clicks'], grain: ['date', 'account_id', 'campaign_id'], rows };
}
