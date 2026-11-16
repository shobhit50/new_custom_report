import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { routeApi } from './routes/api.routes.js';

const frontend = fileURLToPath(new URL('../../frontend/src/', import.meta.url));
const assets = fileURLToPath(new URL('../resources/assets/', import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const staticPaths = {
  '/': path.join(frontend, 'pages/config-builder/config_builder.html'),
  '/config.js': path.join(frontend, 'pages/config-builder/config_builder.js'),
  '/builder': path.join(frontend, 'pages/report-builder/report_builder.html'),
  '/report_builder.js': path.join(frontend, 'pages/report-builder/report_builder.js'),
  '/builder-controller.js': path.join(frontend, 'controllers/builder.controller.js'),
  '/api-client.js': path.join(frontend, 'models/api-client.js')
};
function send(res, code, content, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': process.env.FRONTEND_ORIGIN || '*' });
  res.end(content);
}
async function body(req) {
  let size = 0, text = '';
  for await (const chunk of req) { size += chunk.length; if (size > 2_000_000) throw new Error('Request body too large'); text += chunk; }
  return text ? JSON.parse(text) : {};
}
export function createApp() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': process.env.FRONTEND_ORIGIN || '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }); res.end(); return; }
      if (url.pathname.startsWith('/api/')) {
        const baseUrl = `http://127.0.0.1:${req.socket.localPort}`;
        const result = await routeApi(req.method, url.pathname, req.method === 'POST' ? await body(req) : {}, baseUrl);
        if (!result) return send(res, 404, JSON.stringify({ error: 'Not found' }));
        if (result.png) return send(res, 200, result.png, 'image/png');
        return send(res, 200, JSON.stringify(result));
      }
      let file = staticPaths[url.pathname];
      if (!file && url.pathname.startsWith('/assets/')) {
        const relative = url.pathname.slice('/assets/'.length);
        if (!relative.includes('..') && /^[a-zA-Z0-9_./-]+$/.test(relative)) file = path.join(assets, relative);
      }
      if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
      return send(res, 200, fs.readFileSync(file), mime[path.extname(file)] || 'application/octet-stream');
    } catch (error) {
      return send(res, 400, JSON.stringify({ error: error.message }));
    }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  createApp().listen(port, '127.0.0.1', () => console.log(`Report Studio demo: http://127.0.0.1:${port}`));
}
