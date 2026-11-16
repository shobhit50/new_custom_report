import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resources, writeDatasets } from './models/dataset.model.js';

const root = fileURLToPath(new URL('../', import.meta.url));
export function runDatasetCli(argv = process.argv.slice(2)) {
  let dataDir = path.join(resources, 'data-sources'), output = path.join(root, 'data/datasets.json');
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--help') { console.log('node backend/src/dataset-cli.js [--data-dir PATH] [--output PATH]'); return; }
    if (argv[index] === '--data-dir' && argv[index + 1]) dataDir = argv[++index];
    else if (argv[index] === '--output' && argv[index + 1]) output = argv[++index];
    else throw new Error(`Unknown or incomplete option: ${argv[index]}`);
  }
  writeDatasets(path.resolve(dataDir), path.resolve(output));
  console.log(`Data_Set: ${path.resolve(output)}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { runDatasetCli(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
