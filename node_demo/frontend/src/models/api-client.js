const apiBase = (window.REPORT_STUDIO_API_BASE || '').replace(/\/$/, '');
export async function request(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try { message = (await response.json()).error || message; } catch (_) { /* Keep status. */ }
    throw new Error(message);
  }
  return response.json();
}
export async function downloadPng(payload) {
  const response = await fetch(`${apiBase}/api/reports/png`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!response.ok) { const result = await response.json(); throw new Error(result.error || 'PNG generation failed'); }
  const blob = await response.blob();
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob); link.download = 'report.png'; link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 30_000);
}
