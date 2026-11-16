(() => {
  const $ = (id) => document.getElementById(id);
  const configId = new URLSearchParams(location.search).get('config') || 'default';
  const STORAGE_KEY = `lyxel-report-studio-node-demo-${configId}`;
  const sources = ['GA4', 'Google Ads', 'Meta Ads', 'Shopify', 'Calculated'];
  const metrics = ['Revenue', 'Sessions', 'Spend', 'Transactions', 'Users', 'ROI', 'Total'];
  let activeConfig = null;
  const sourceMap = { GA4: 'perf_ga4', 'Google Ads': 'perf_google', 'Meta Ads': 'perf_meta', 'Meta Ads B2B': 'b2b_meta', Shopify: 'perf_shopify' };
  const sourceLabels = { perf_ga4: 'GA4', perf_google: 'Google Ads', perf_meta: 'Meta Ads', b2b_meta: 'Meta Ads B2B', perf_shopify: 'Shopify' };
  const metricOptions = (source, current) => {
    if (!activeConfig) return metrics;
    const id = sourceMap[source] || source;
    const chosen = activeConfig.selections.filter((item) => item.source === id).map((item) => item.metric);
    return [...new Set([current, ...chosen].filter(Boolean))];
  };
  const sourceOptions = (current) => [...new Set([...sources, ...(activeConfig?.selections.map((item) => sourceLabels[item.source] || item.source) || []), current].filter(Boolean))];
  const formats = ['Number · 2 decimals', 'Currency · 2 decimals', 'Integer', 'Percent', 'Text'];
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);

  function seedState() {
    const periods = [
      { id: 'period-1', label: 'MTD Oct ’26', start: '2026-10-01', end: '2026-10-13' },
      { id: 'period-2', label: '13 Oct', start: '2026-10-13', end: '2026-10-13' },
      { id: 'period-3', label: '12 Oct', start: '2026-10-12', end: '2026-10-12' }
    ];
    const row = (id, label, source, metric, values, total = false) => ({
      id, label, total,
      cells: values.map((value, index) => ({
        id: `${id}-cell-${index + 1}`, kind: total ? 'Calculated' : 'Actual data',
        source, metric, format: 'Number · 2 decimals', previewValue: value, formula: ''
      }))
    });
    return {
      nextId: 20,
      name: 'Daily Performance / Draft', preview: false, issue: false,
      blocks: [{
        id: 'block-1', title: 'Daily performance',
        tables: [{
          id: 'table-1', title: 'Daily Performance Report', periods,
          rows: [
            row('row-1', 'Revenue as per GA4', 'GA4', 'Revenue', ['370,079.11', '7,011.12', '46,450.00']),
            row('row-2', 'Sessions as per GA4', 'GA4', 'Sessions', ['8,577.00', '251.00', '725.00']),
            row('row-3', 'Amount Spent (Google Ads)', 'Google Ads', 'Spend', ['3,251,244.74', '113,544.42', '238,001.54']),
            row('row-4', 'Amount Spent (Meta)', 'Meta Ads', 'Spend', ['889,623.92', '41,390.91', '85,423.06']),
            row('row-5', 'Total Amount Spent', 'Calculated', 'Total', ['4,140,868.66', '154,935.33', '323,424.60'], true),
            row('row-6', 'Overall ROI as per GA4', 'Calculated', 'ROI', ['0.09', '0.05', '0.14'])
          ]
        }]
      }],
      selected: { kind: 'table', b: 0, t: 0, r: 0, c: 0 }
    };
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved && Array.isArray(saved.blocks) && saved.blocks.length) return saved;
    } catch (_) { /* Browsers may restrict storage for file URLs. */ }
    return seedState();
  }
  let state = loadState();
  let toastTimer;
  const block = (b = state.selected.b) => state.blocks[b];
  const table = (b = state.selected.b, t = state.selected.t) => block(b)?.tables[t];
  const row = (b = state.selected.b, t = state.selected.t, r = state.selected.r) => table(b, t)?.rows[r];
  const cell = (b = state.selected.b, t = state.selected.t, r = state.selected.r, c = state.selected.c) => row(b, t, r)?.cells[c];
  const id = (prefix) => `${prefix}-${state.nextId++}`;

  function notify(message) {
    $('toast').textContent = message;
    $('toast').classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('toast').classList.remove('show'), 3200);
  }
  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) { /* UI still works. */ }
    $('saveBadge').textContent = state.issue ? '1 ISSUE' : 'SAVED';
    $('saveBadge').className = `badge ${state.issue ? 'warn' : 'ok'}`;
    $('pngButton').disabled = state.issue;
    $('issueButton').textContent = state.issue ? 'Clear issue' : 'Show issue';
    $('footerStatus').textContent = state.issue
      ? 'Fix the highlighted cell before generating a PNG.'
      : 'Draft saved locally · canvas preview updated';
  }
  function select(kind, b = 0, t = 0, r = 0, c = 0) {
    state.selected = { kind, b, t, r, c };
    render();
    const location = `[data-b="${b}"][data-t="${t}"]`;
    const candidates = kind === 'block'
      ? `[data-kind="block"][data-b="${b}"]`
      : kind === 'row'
        ? `[data-kind="row"]${location}[data-r="${r}"]`
        : kind === 'cell'
          ? `[data-kind="cell"]${location}[data-r="${r}"][data-c="${c}"]`
          : kind === 'period'
            ? `[data-kind="period"]${location}[data-c="${c}"]`
            : `[data-kind="table"]${location}`;
    const target = $('reportCanvas').querySelector(candidates);
    target?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
  }
  const selected = (kind, b, t = 0, r = 0, c = 0) => {
    const s = state.selected;
    return s.kind === kind && s.b === b && (kind === 'block' || kind === 'report' || s.t === t) &&
      (kind !== 'row' && kind !== 'cell' || s.r === r) && (kind !== 'period' && kind !== 'cell' || s.c === c);
  };
  function treeButton(kind, text, depth, b, t = 0, r = 0, c = 0, icon = '▦') {
    return `<button class="tree-row indent${depth} ${selected(kind, b, t, r, c) ? 'selected' : ''}" data-select="1" data-kind="${kind}" data-b="${b}" data-t="${t}" data-r="${r}" data-c="${c}"><span class="icon">${icon}</span><span>${escapeHtml(text)}</span></button>`;
  }
  function renderTree() {
    let html = treeButton('report', 'Report canvas', 0, 0);
    state.blocks.forEach((b, bi) => {
      html += treeButton('block', b.title, 1, bi, 0, 0, 0, '▾');
      b.tables.forEach((t, ti) => {
        html += treeButton('table', `Table · ${t.title}`, 2, bi, ti);
        html += treeButton('period', `Periods · ${t.periods.length}`, 2, bi, ti, 0, 0, '▣');
        html += treeButton('header', `Headers · ${t.periods.length + 1}`, 2, bi, ti, 0, 0, '▤');
        html += treeButton('rows', `Rows · ${t.rows.length}`, 2, bi, ti, 0, 0, '☷');
        t.rows.forEach((r, ri) => {
          html += treeButton('row', r.label, 3, bi, ti, ri, 0, '↳');
          if (state.selected.kind === 'cell' && state.selected.b === bi && state.selected.t === ti && state.selected.r === ri) {
            const period = t.periods[state.selected.c];
            html += treeButton('cell', `Cell · ${period?.label || 'New column'}`, 3, bi, ti, ri, state.selected.c, '□');
          }
        });
      });
    });
    $('tree').innerHTML = html;
    $('tree').querySelectorAll('[data-select]').forEach((button) => {
      button.addEventListener('click', () => select(button.dataset.kind, +button.dataset.b, +button.dataset.t, +button.dataset.r, +button.dataset.c));
    });
  }

  function renderCanvas() {
    let html = '';
    state.blocks.forEach((b, bi) => {
      html += `<section class="canvas-block"><button class="canvas-block-title ${selected('block', bi) ? 'active' : ''}" data-select="1" data-kind="block" data-b="${bi}">${escapeHtml(b.title)}</button>`;
      if (!b.tables.length) html += `<div class="placeholder" data-select="1" data-kind="block" data-b="${bi}"><strong>No table in this block yet</strong><span>Select this block, then click “Add table”.</span></div>`;
      b.tables.forEach((t, ti) => {
        html += `<div class="table-wrap ${selected('table', bi, ti) ? 'selected' : ''}"><table aria-label="${escapeHtml(t.title)}"><thead><tr>`;
        html += `<th data-select="1" data-kind="table" data-b="${bi}" data-t="${ti}">${escapeHtml(t.title)}</th>`;
        t.periods.forEach((p, ci) => {
          html += `<th class="${selected('period', bi, ti, 0, ci) ? 'selected' : ''}" data-select="1" data-kind="period" data-b="${bi}" data-t="${ti}" data-c="${ci}">${escapeHtml(p.label)}</th>`;
        });
        html += '</tr></thead><tbody>';
        if (!t.rows.length) html += `<tr><td colspan="${t.periods.length + 1}" class="empty-table">No rows yet. Select this table, then click “Add row”.</td></tr>`;
        t.rows.forEach((r, ri) => {
          html += `<tr class="${r.total ? 'total' : ''}"><td class="${selected('row', bi, ti, ri) ? 'selected' : ''}" data-select="1" data-kind="row" data-b="${bi}" data-t="${ti}" data-r="${ri}">${escapeHtml(r.label)}</td>`;
          r.cells.forEach((c, ci) => {
            const problem = state.issue && bi === 0 && ti === 0 && ri === 0 && ci === 1;
            const value = problem ? '⚠ —' : c.previewValue || '—';
            html += `<td class="${problem ? 'problem ' : ''}${selected('cell', bi, ti, ri, ci) ? 'selected' : ''}" data-select="1" data-kind="cell" data-b="${bi}" data-t="${ti}" data-r="${ri}" data-c="${ci}">${escapeHtml(value)}</td>`;
          });
          html += '</tr>';
        });
        html += '</tbody></table></div>';
      });
      html += '</section>';
    });
    $('reportCanvas').innerHTML = html;
    $('reportCanvas').querySelectorAll('[data-select]').forEach((el) => {
      el.addEventListener('click', () => select(el.dataset.kind, +el.dataset.b, +(el.dataset.t || 0), +(el.dataset.r || 0), +(el.dataset.c || 0)));
    });
    $('canvasHint').classList.toggle('warn', state.issue);
    $('canvasHint').lastElementChild.textContent = state.issue
      ? 'The highlighted cell needs data for 13 Oct.'
      : 'Illustrative values from the DSR reference report.';
  }

  function field(name, value, key, type = 'text') {
    return `<label class="form-field"><span>${escapeHtml(name)}</span><input data-field="${key}" type="${type}" value="${escapeHtml(value)}"></label>`;
  }
  function choice(name, value, key, options) {
    return `<label class="form-field"><span>${escapeHtml(name)}</span><select data-field="${key}">${options.map((option) => `<option ${option === value ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}</select></label>`;
  }
  function inspectorHtml() {
    const s = state.selected, b = block(s.b), t = table(s.b, s.t), r = row(s.b, s.t, s.r), c = cell(s.b, s.t, s.r, s.c);
    if (s.kind === 'report') return `<h2>Report canvas</h2><p class="help">Start with the sample report, then add as many blocks as you need.</p>${field('Report name', state.name, 'reportName')}<div class="status-card"><strong>${state.blocks.length} block${state.blocks.length === 1 ? '' : 's'}</strong>Choose a block in Structure to add its tables.</div>`;
    if (s.kind === 'block') return `<h2>${escapeHtml(b.title)}</h2><p class="help">A block groups one or more report tables.</p>${field('Block title', b.title, 'blockTitle')}<div class="status-card"><strong>${b.tables.length} table${b.tables.length === 1 ? '' : 's'} in this block</strong>Click “Add table” to extend this block.</div>`;
    if (s.kind === 'table' || s.kind === 'header') return `<h2>${escapeHtml(t.title)}</h2><p class="help">The table contains date columns, rows and editable cells.</p>${field('Table title', t.title, 'tableTitle')}<div class="mini-section"><div class="section-title">PERIODS / HEADERS</div>${t.periods.map((p, ci) => `<div class="period-row"><span>${escapeHtml(p.label)}</span><button data-select="1" data-kind="period" data-b="${s.b}" data-t="${s.t}" data-c="${ci}">Edit</button></div>`).join('')}<button class="secondary full" data-action="addPeriod">+ Add period</button></div><div class="mini-section"><div class="section-title">ROWS AND CELLS</div><p class="empty">${t.rows.length} rows · ${t.periods.length} value columns</p><button class="secondary full" data-action="addRow">+ Add row</button></div>`;
    if (s.kind === 'period') {
      const p = t.periods[s.c];
      return `<h2>${escapeHtml(p.label)}</h2><p class="help">This period becomes a column in the report.</p>${field('Column label', p.label, 'periodLabel')}${field('Start date', p.start, 'periodStart', 'date')}${field('End date', p.end, 'periodEnd', 'date')}<div class="status-card"><strong>Visible in ${t.rows.length} row${t.rows.length === 1 ? '' : 's'}</strong>Every row has a cell for this period.</div>`;
    }
    if (s.kind === 'rows') return `<h2>Rows</h2><p class="help">Add a metric or label. Every new row receives a blank cell under each period.</p><div class="status-card"><strong>${t.rows.length} rows</strong>${t.periods.length} cells will be created for each new row.</div><button class="primary full" data-action="addRow">+ Add row</button>`;
    if (s.kind === 'row') return `<h2>${escapeHtml(r.label)}</h2><p class="help">Edit this row, then click a value in the canvas to edit its cell.</p>${field('Row label', r.label, 'rowLabel')}${choice('Row style', r.total ? 'Total / highlighted' : 'Normal', 'rowStyle', ['Normal', 'Total / highlighted'])}<div class="mini-section"><div class="section-title">CELLS IN THIS ROW</div>${t.periods.map((p, ci) => `<div class="period-row"><span>${escapeHtml(p.label)} · ${escapeHtml(r.cells[ci].previewValue || '—')}</span><button data-select="1" data-kind="cell" data-b="${s.b}" data-t="${s.t}" data-r="${s.r}" data-c="${ci}">Edit</button></div>`).join('')}<button class="secondary full" data-action="addCell">+ Add cell / column</button></div>`;
    const isIssue = state.issue && s.b === 0 && s.t === 0 && s.r === 0 && s.c === 1;
    return `<h2>${escapeHtml(r.label)} · ${escapeHtml(t.periods[s.c].label)}</h2><p class="help">Choose what appears in this cell. Preview value is for this local demo only.</p>${isIssue ? `<div class="status-card warning"><strong>⚠ No GA4 revenue for 13 Oct</strong>Choose a fix below.</div><button class="primary full" data-action="fixIssue">Use sample value</button>` : ''}${choice('Cell type', c.kind, 'cellKind', ['Actual data', 'Fixed text', 'Calculated'])}${choice('Source', c.source, 'cellSource', sourceOptions(c.source))}${choice('Metric', c.metric, 'cellMetric', metricOptions(c.source, c.metric))}${field('Preview value', c.previewValue, 'cellValue')}${c.kind === 'Calculated' ? field('Formula description', c.formula, 'cellFormula') : ''}${choice('Number format', c.format, 'cellFormat', formats)}<div class="status-card"><strong>Cell ${s.c + 1} of ${t.periods.length}</strong>To add another cell, add a column so every row stays aligned.</div><button class="secondary full" data-action="addCell">+ Add cell / column</button>`;
  }
  function renderInspector() {
    $('inspectorBody').innerHTML = inspectorHtml();
    $('inspectorBody').querySelectorAll('[data-select]').forEach((el) => el.addEventListener('click', () => select(el.dataset.kind, +el.dataset.b, +el.dataset.t, +(el.dataset.r || 0), +(el.dataset.c || 0))));
    $('inspectorBody').querySelectorAll('[data-action]').forEach((el) => el.addEventListener('click', () => actions[el.dataset.action]()));
    $('inspectorBody').querySelectorAll('[data-field]').forEach((el) => {
      el.addEventListener(el.tagName === 'SELECT' || el.type === 'date' ? 'change' : 'input', () => updateField(el.dataset.field, el.value));
    });
  }
  function updateField(key, value) {
    const s = state.selected, b = block(s.b), t = table(s.b, s.t), r = row(s.b, s.t, s.r), c = cell(s.b, s.t, s.r, s.c);
    if (key === 'reportName') { state.name = value; $('reportName').value = value; }
    if (key === 'blockTitle') b.title = value;
    if (key === 'tableTitle') t.title = value;
    if (key === 'periodLabel') t.periods[s.c].label = value;
    if (key === 'periodStart') t.periods[s.c].start = value;
    if (key === 'periodEnd') t.periods[s.c].end = value;
    if (key === 'rowLabel') r.label = value;
    if (key === 'rowStyle') r.total = value.startsWith('Total');
    if (key === 'cellKind') c.kind = value;
    if (key === 'cellSource') { c.source = value; c.metric = metricOptions(value, '')[0] || c.metric; }
    if (key === 'cellMetric') c.metric = value;
    if (key === 'cellValue') c.previewValue = value;
    if (key === 'cellFormula') c.formula = value;
    if (key === 'cellFormat') c.format = value;
    renderTree(); renderCanvas(); renderContext(); persist();
    if (key === 'cellKind' || key === 'cellSource') renderInspector();
  }
  function renderContext() {
    const s = state.selected, b = block(s.b), t = table(s.b, s.t), r = row(s.b, s.t, s.r);
    const type = s.kind === 'rows' ? 'ROWS' : s.kind.toUpperCase();
    $('selectionChip').textContent = state.issue && s.kind === 'cell' && s.b === 0 && s.t === 0 && s.r === 0 && s.c === 1 ? 'NEEDS ATTENTION' : `${type} SELECTED`;
    $('selectionPath').textContent = [state.name, b?.title, t?.title, s.kind === 'row' || s.kind === 'cell' ? r?.label : null, s.kind === 'cell' || s.kind === 'period' ? t?.periods[s.c]?.label : null].filter(Boolean).join(' / ');
    $('selectionKind').textContent = type;
    $('reportMeta').textContent = `${state.name} · sample report`;
    $('editTab').classList.toggle('active', !state.preview);
    $('previewTab').classList.toggle('active', state.preview);
    $('inspectorBody').style.opacity = state.preview ? '.6' : '1';
  }
  function render() {
    $('reportName').value = state.name;
    renderTree(); renderCanvas(); renderInspector(); renderContext(); persist();
  }
  function addBlock() {
    const b = { id: id('block'), title: `New block ${state.blocks.length}`, tables: [] };
    state.blocks.push(b); select('block', state.blocks.length - 1);
    notify('Block added. Now add a table inside it.');
  }
  function addTable() {
    const bi = state.selected.kind === 'report' ? 0 : state.selected.b;
    const b = block(bi);
    const t = { id: id('table'), title: `New table ${b.tables.length + 1}`, periods: [{ id: id('period'), label: 'Today', start: '', end: '' }], rows: [] };
    b.tables.push(t); select('table', bi, b.tables.length - 1);
    notify('Table added. Add a row to fill it.');
  }
  function addRow() {
    const s = state.selected, t = table(s.b, s.t);
    if (!t) { notify('Select a table or add one first.'); return; }
    const r = { id: id('row'), label: `New row ${t.rows.length + 1}`, total: false,
      cells: t.periods.map(() => ({ id: id('cell'), kind: 'Actual data', source: 'GA4', metric: 'Revenue', format: 'Number · 2 decimals', previewValue: '', formula: '' })) };
    t.rows.push(r); select('row', s.b, s.t, t.rows.length - 1);
    notify('Row added with one blank cell per column.');
  }
  function addPeriod() {
    const s = state.selected, t = table(s.b, s.t);
    if (!t) { notify('Select a table first.'); return; }
    t.periods.push({ id: id('period'), label: `New column ${t.periods.length + 1}`, start: '', end: '' });
    t.rows.forEach((r) => r.cells.push({ id: id('cell'), kind: 'Actual data', source: 'GA4', metric: 'Revenue', format: 'Number · 2 decimals', previewValue: '', formula: '' }));
    select('period', s.b, s.t, 0, t.periods.length - 1);
    notify('Column added. Every row now has a blank cell for it.');
  }
  function addCell() {
    const s = state.selected, t = table(s.b, s.t);
    if (!t || !t.rows.length) { notify('Add a row to the table first.'); return; }
    const ri = s.kind === 'cell' || s.kind === 'row' ? s.r : 0;
    addPeriod();
    select('cell', s.b, s.t, ri, t.periods.length - 1);
    notify('New cell selected. The matching column was added for every row.');
  }
  const actions = {
    addBlock, addTable, addRow, addPeriod, addCell,
    fixIssue() { state.issue = false; select('cell', 0, 0, 0, 1); notify('Sample value restored. PNG action is available again.'); }
  };
  $('addBlock').addEventListener('click', addBlock);
  $('addTable').addEventListener('click', addTable);
  $('addRow').addEventListener('click', addRow);
  $('addCell').addEventListener('click', addCell);
  $('reportName').addEventListener('input', (event) => { state.name = event.target.value; renderContext(); persist(); });
  $('issueButton').addEventListener('click', () => { state.issue = !state.issue; select('cell', 0, 0, 0, 1); });
  $('resetButton').addEventListener('click', () => { state = seedState(); if (activeConfig) state.name = activeConfig.name; render(); notify('Default sample restored.'); });
  $('editTab').addEventListener('click', () => { state.preview = false; render(); });
  $('previewTab').addEventListener('click', () => { state.preview = true; render(); });
  $('pngButton').addEventListener('click', () => window.reportStudioGenerate ? window.reportStudioGenerate() : notify('Backend is loading. Please try again.'));
  window.reportStudioDemo = {
    state: () => structuredClone(state),
    reset: () => { state = seedState(); if (activeConfig) state.name = activeConfig.name; render(); },
    setConfig: (config) => { activeConfig = config; state.name = config.name; render(); }
  };
  render();
})();
