import { buildDatasets, metricCatalog } from '../models/dataset.model.js';

export function catalog() { return { datasets: metricCatalog(buildDatasets()) }; }
