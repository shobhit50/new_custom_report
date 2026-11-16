import { buildDatasets } from '../models/dataset.model.js';
import { getConfig } from '../models/config.model.js';
import { getPreset, listPresets, stateToConfig } from '../models/report.model.js';
import { renderHtml } from '../services/report-renderer.js';
import { renderPng } from '../services/png-renderer.js';

export function presets() { return { presets: listPresets() }; }
export function preset(id) { return { config: getPreset(id) }; }
function prepare(body, baseUrl) {
  const datasets = buildDatasets();
  const selected = body.configId ? getConfig(body.configId).selections : null;
  const config = body.config || stateToConfig(body.state, selected, datasets);
  const date = body.reportDate || '2026-10-13';
  return renderHtml(config, datasets, { reportDate: date, baseUrl });
}
export function preview(body, baseUrl) { return { html: prepare(body, baseUrl) }; }
export async function png(body, baseUrl) { return renderPng(prepare(body, baseUrl)); }
