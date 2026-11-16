import { request, downloadPng } from '/api-client.js';

const id = new URLSearchParams(location.search).get('config');
const studio = window.reportStudioDemo;
const notice = document.getElementById('footerStatus');
if (id) {
  try {
    const { config } = await request(`/api/configs/${encodeURIComponent(id)}`);
    studio.setConfig(config);
    notice.textContent = `Config: ${config.name} · ${config.selections.length} selected metrics`;
  } catch (error) { notice.textContent = `Config could not be loaded: ${error.message}`; }
}
window.reportStudioGenerate = async () => {
  const button = document.getElementById('pngButton');
  button.disabled = true; button.textContent = 'Generating…';
  try {
    await downloadPng({ state: studio.state(), configId: id || undefined, reportDate: '2026-10-13' });
    notice.textContent = 'PNG downloaded from Node.js backend.';
  } catch (error) {
    notice.textContent = `PNG failed: ${error.message}`;
  } finally { button.disabled = false; button.textContent = 'Generate PNG'; }
};
