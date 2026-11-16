import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildDatasets, metricCatalog } from './dataset.model.js';
import { validateSourceConfig } from './source-config.model.js';

const directory = fileURLToPath(new URL('../../data/configs/', import.meta.url));
fs.mkdirSync(directory, { recursive: true });
const filename = (id) => path.join(directory, `${id}.json`);
export function listConfigs() {
  return fs.readdirSync(directory).filter((name) => /^[0-9a-f-]{36}\.json$/.test(name)).map((name) => {
    const item = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
    return { id: item.id, name: item.name, createdAt: item.createdAt, selections: item.selections.length,
      sourceCount: item.sourceConfig?.inputs?.length || 0, breakdown: item.sourceConfig?.breakdown };
  });
}
export function getConfig(id) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid config ID');
  if (!fs.existsSync(filename(id))) throw new Error('Config not found');
  return JSON.parse(fs.readFileSync(filename(id), 'utf8'));
}
export function createConfig(input) {
  const name = String(input?.name || '').trim();
  if (!name || name.length > 160) throw new Error('Config name must be 1–160 characters');
  const catalog = metricCatalog(buildDatasets());
  const available = new Set(catalog.flatMap((source) => source.metrics.map((metric) => `${source.id}:${metric}`)));
  const selections = input?.selections;
  if (!Array.isArray(selections) || (!selections.length && !input?.sourceConfig)) throw new Error('Choose at least one metric');
  if (selections.length > 50) throw new Error('Too many metrics');
  const unique = new Set();
  for (const item of selections) {
    const key = `${item?.source}:${item?.metric}`;
    if (!available.has(key)) throw new Error(`Unknown metric ${key}`);
    unique.add(key);
  }
  const sourceConfig = input?.sourceConfig ? validateSourceConfig(input.sourceConfig) : undefined;
  const item = { id: randomUUID(), name, selections: [...unique].map((key) => { const [source, metric] = key.split(':'); return { source, metric }; }), ...(sourceConfig ? { sourceConfig } : {}), createdAt: new Date().toISOString() };
  fs.writeFileSync(filename(item.id), `${JSON.stringify(item, null, 2)}\n`, { flag: 'wx' });
  return item;
}
