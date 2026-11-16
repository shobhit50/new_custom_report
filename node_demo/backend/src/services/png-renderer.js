import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { inflateSync, deflateSync } from 'node:zlib';

const browserCandidates = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function activePort(profile) {
  const file = path.join(profile, 'DevToolsActivePort');
  for (let count = 0; count < 100; count++) {
    if (fs.existsSync(file)) return Number(fs.readFileSync(file, 'utf8').split('\n')[0]);
    await pause(100);
  }
  throw new Error('Chrome did not start remote debugging');
}
function client(url) {
  const socket = new WebSocket(url), pending = new Map();
  let sequence = 0;
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id); pending.delete(message.id);
    message.error ? reject(new Error(message.error.message)) : resolve(message.result);
  });
  socket.addEventListener('close', () => {
    for (const { reject } of pending.values()) reject(new Error('Chrome debugging connection closed'));
    pending.clear();
  });
  return {
    async send(method, params = {}) {
      await ready;
      const id = ++sequence;
      return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
    },
    close() { socket.close(); }
  };
}
function decodePng(png) {
  let offset = 8, width, height, depth, colour;
  const pieces = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset), type = png.toString('ascii', offset + 4, offset + 8);
    if (type === 'IHDR') { width = png.readUInt32BE(offset + 8); height = png.readUInt32BE(offset + 12); depth = png[offset + 16]; colour = png[offset + 17]; }
    if (type === 'IDAT') pieces.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const channels = colour === 2 ? 3 : colour === 6 ? 4 : 0;
  if (depth !== 8 || !channels) throw new Error('Unsupported PNG colour format');
  const bytes = inflateSync(Buffer.concat(pieces)), stride = width * channels;
  const pixels = Buffer.alloc(width * height * 3);
  let previous = Buffer.alloc(stride), position = 0, last = -1;
  for (let y = 0; y < height; y++) {
    const filter = bytes[position++], row = Buffer.from(bytes.subarray(position, position + stride));
    position += stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? row[x - channels] : 0, up = previous[x], aboveLeft = x >= channels ? previous[x - channels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = Math.floor((left + up) / 2);
      else if (filter === 4) {
        const p = left + up - aboveLeft, a = Math.abs(p - left), b = Math.abs(p - up), c = Math.abs(p - aboveLeft);
        predictor = a <= b && a <= c ? left : b <= c ? up : aboveLeft;
      }
      row[x] = (row[x] + predictor) & 255;
    }
    for (let x = 0; x < stride; x += channels) {
      const target = (y * width + x / channels) * 3;
      for (let channel = 0; channel < 3; channel++) pixels[target + channel] = channels === 4 ? Math.round((row[x + channel] * row[x + 3] + 255 * (255 - row[x + 3])) / 255) : row[x + channel];
      if (pixels[target] !== 255 || pixels[target + 1] !== 255 || pixels[target + 2] !== 255) last = y;
    }
    previous = row;
  }
  return { width, height, pixels, last };
}
const crcTable = Array.from({ length: 256 }, (_, n) => { let value = n; for (let i = 0; i < 8; i++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1; return value >>> 0; });
function chunk(type, data) {
  const name = Buffer.from(type), output = Buffer.alloc(data.length + 12);
  output.writeUInt32BE(data.length, 0); name.copy(output, 4); data.copy(output, 8);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([name, data])) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  output.writeUInt32BE((crc ^ 0xffffffff) >>> 0, output.length - 4);
  return output;
}
function encodeRgb(width, height, pixels) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const stride = width * 3, raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
export function combinePngs(images, gap = 20) {
  if (!images.length) return null;
  const decoded = images.map(decodePng), width = Math.max(...decoded.map((image) => image.width)), height = decoded.reduce((sum, image) => sum + image.height, 0) + gap * (decoded.length - 1);
  const pixels = Buffer.alloc(width * height * 3, 255);
  let top = 0;
  for (const image of decoded) {
    for (let y = 0; y < image.height; y++) image.pixels.copy(pixels, ((top + y) * width) * 3, y * image.width * 3, (y + 1) * image.width * 3);
    top += image.height + gap;
  }
  return encodeRgb(width, height, pixels);
}
export async function renderPng(html, width = 1600) {
  const binary = browserCandidates.find((candidate) => fs.existsSync(candidate));
  if (!binary) throw new Error('Chrome or Chromium is required for PNG output; set CHROME_BIN');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'report-node-'));
  const file = path.join(profile, 'report.html');
  fs.writeFileSync(file, html, 'utf8');
  const process = spawn(binary, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', '--remote-allow-origins=*', `--user-data-dir=${profile}`, '--allow-file-access-from-files', `--window-size=${width},900`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '', stage = 'startup';
  process.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-2000); });
  let cdp;
  try {
    const port = await activePort(profile); stage = 'target';
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const target = targets.find((item) => item.type === 'page');
    if (!target) throw new Error('Chrome did not create a page');
    cdp = client(target.webSocketDebuggerUrl); stage = 'navigation';
    await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: pathToFileURL(file).href });
    for (let count = 0; count < 100; count++) {
      const result = await cdp.send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
      if (result.result?.value === 'complete') break;
      await pause(100);
    }
    await cdp.send('Runtime.evaluate', { expression: 'Promise.all([document.fonts.ready, ...Array.from(document.images, image => image.complete ? Promise.resolve() : new Promise(resolve => { image.onload = resolve; image.onerror = resolve; }))])', awaitPromise: true });
    const size = await cdp.send('Runtime.evaluate', { expression: 'Math.ceil(Math.max(document.documentElement.scrollHeight, document.body.scrollHeight))', returnByValue: true });
    const height = Math.max(1, Math.min(30000, size.result.value));
    const capture = async (h) => Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, fromSurface: true, clip: { x: 0, y: 0, width, height: h, scale: 1 } })).data, 'base64');
    stage = 'initial capture';
    const initial = await capture(height);
    const trimmedHeight = Math.max(1, Math.min(height, decodePng(initial).last + 21));
    stage = 'trimmed capture';
    return trimmedHeight < height ? await capture(trimmedHeight) : initial;
  } catch (error) {
    throw new Error(`PNG render failed at ${stage}: ${error.message}${stderr ? `; Chrome: ${stderr.slice(-600)}` : ''}`);
  } finally {
    cdp?.close();
    const exited = new Promise((resolve) => process.once('exit', resolve));
    process.kill();
    await Promise.race([exited, pause(1000)]);
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
