import { createConfig, getConfig, listConfigs } from '../models/config.model.js';
import { sourceConfigCatalog } from '../models/source-config.model.js';

export function list() { return { configs: listConfigs() }; }
export function read(id) { return { config: getConfig(id) }; }
export function create(body) { return { config: createConfig(body) }; }
export function catalog() { return sourceConfigCatalog(); }
