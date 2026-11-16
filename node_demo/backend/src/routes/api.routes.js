import * as config from '../controllers/config.controller.js';
import * as dataset from '../controllers/dataset.controller.js';
import * as report from '../controllers/report.controller.js';

export async function routeApi(method, pathname, body, baseUrl) {
  if (method === 'GET' && pathname === '/api/datasets/catalog') return dataset.catalog();
  if (method === 'GET' && pathname === '/api/source-config/catalog') return config.catalog();
  if (method === 'GET' && pathname === '/api/configs') return config.list();
  if (method === 'POST' && pathname === '/api/configs') return config.create(body);
  if (method === 'GET' && /^\/api\/configs\/[0-9a-f-]+$/.test(pathname)) return config.read(pathname.split('/').at(-1));
  if (method === 'GET' && pathname === '/api/reports/presets') return report.presets();
  if (method === 'GET' && /^\/api\/reports\/presets\/[a-zA-Z0-9_-]+$/.test(pathname)) return report.preset(pathname.split('/').at(-1));
  if (method === 'POST' && pathname === '/api/reports/preview') return report.preview(body, baseUrl);
  if (method === 'POST' && pathname === '/api/reports/png') return { png: await report.png(body, baseUrl) };
  return null;
}
