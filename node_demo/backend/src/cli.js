import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resources, writeDatasets } from './models/dataset.model.js';
import { getPreset, listPresets } from './models/report.model.js';
import { renderHtml } from './services/report-renderer.js';
import { combinePngs, renderPng } from './services/png-renderer.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const defaults = { dataDir: path.join(resources, 'data-sources'), datasetOutput: path.join(root, 'data/datasets.json'), outputDir: path.join(root, 'data/output'), reportDate: new Date().toISOString().slice(0, 10) };
function options(argv) {
  const out = { ...defaults };
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index];
    if (key === '--help') { out.help = true; continue; }
    if (key === '--demo') { out.demo = true; continue; }
    const name = { '--config': 'config', '--data-dir': 'dataDir', '--dataset-output': 'datasetOutput', '--report-date': 'reportDate', '--png': 'png' }[key];
    if (!name || !argv[index + 1]) throw new Error(`Unknown or incomplete option: ${key}`);
    out[name] = argv[++index];
  }
  if (out.demo && out.config) throw new Error('--demo and --config cannot be used together');
  if (!out.demo && !out.config && out.png) throw new Error('--png requires --config or --demo');
  return out;
}
const usage = `Report Studio Node CLI\n\n  node backend/src/cli.js [--config PATH | --demo] [--data-dir PATH] [--dataset-output PATH] [--report-date YYYY-MM-DD] [--png PATH]\n\nWithout --config, render all copied configs and a combined report.png. --demo renders the DSR sample.\n`;
async function saveReport(config, datasets, reportDate, destination) {
  const html = renderHtml(config, datasets, { reportDate, baseUrl: pathToFileURL(resources.replace(/\/$/, '')).href });
  const png = await renderPng(html);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, png);
  console.log(`PNG: ${destination}`);
  return png;
}
export async function runCli(argv = process.argv.slice(2)) {
  const args = options(argv);
  if (args.help) { console.log(usage); return; }
  const datasets = writeDatasets(path.resolve(args.dataDir), path.resolve(args.datasetOutput));
  console.log(`Data_Set: ${path.resolve(args.datasetOutput)}`);
  if (args.demo || args.config) {
    const config = args.demo ? getPreset('dsr_reference') : JSON.parse(fs.readFileSync(path.resolve(args.config), 'utf8'));
    const name = args.demo ? 'demo' : path.basename(args.config, '.json');
    const destination = path.resolve(args.png || path.join(args.outputDir, `${name}.png`));
    await saveReport(config, datasets, args.reportDate, destination);
    return;
  }
  const images = [], failures = [];
  for (const { id } of listPresets()) {
    const destination = path.join(args.outputDir, `${id}.png`);
    try { images.push(await saveReport(getPreset(id), datasets, args.reportDate, destination)); }
    catch (error) { fs.rmSync(destination, { force: true }); failures.push(`${id}: ${error.message}`); console.error(`FAILED ${id}: ${error.message}`); }
  }
  if (images.length) {
    const combined = path.join(args.outputDir, 'report.png');
    fs.writeFileSync(combined, combinePngs(images));
    console.log(`All reports PNG: ${combined}`);
  }
  if (failures.length) throw new Error(`${failures.length} report(s) failed`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCli().catch((error) => { console.error(error.message); process.exitCode = 1; });
