import { validateConfig } from './schema-validator.js';

const MAX_ROWS = 2000, MAX_COLS = 120, MAX_CELLS = 150000, MAX_DAYS = 366;
const BINDING_KEYS = ['source', 'metric', 'segment', 'period'];
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const copy = (value) => structuredClone(value);
function fail(message) { throw new Error(message); }
function number(value) {
  if (value === null || value === '') return null;
  if (typeof value === 'boolean' || !Number.isFinite(Number(value))) fail(`Non-numeric value: ${value}`);
  return Number(value);
}
function iso(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(`Invalid ISO date ${value}`);
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) fail(`Invalid ISO date ${value}`);
  return value;
}
function dateAdd(value, days) { return new Date(Date.parse(`${value}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10); }
function periodsFor(table, today) {
  const resolve = (value) => value === 'report_date' ? today : value === 'month_start(report_date)' ? `${today.slice(0, 7)}-01` : value === 'year_start(report_date)' ? `${today.slice(0, 4)}-01-01` : iso(value);
  const result = {};
  for (const [key, item] of Object.entries(table.periods || {})) {
    const start = resolve(item.start_date), end = resolve(item.end_date);
    if (start > end) fail(`start_date after end_date: ${key}`);
    if ((Date.parse(end) - Date.parse(start)) / 86400000 > 3660) fail('Period exceeds 10 years');
    result[key] = [start, end];
  }
  return result;
}
function substitute(value, context) {
  if (typeof value !== 'string') return value;
  return value.replace(/\{([a-zA-Z_][\w]*)\}/g, (_, key) => {
    if (!has(context, key)) fail(`Unknown expansion variable: ${key}`);
    return String(context[key]);
  });
}
function merge(...parts) {
  const result = {};
  for (const part of parts) for (const [key, value] of Object.entries(part || {})) {
    if (value === null || value === undefined) continue;
    if (has(result, key) && result[key] !== value) fail(`Conflicting constraint ${key}: ${result[key]} vs ${value}`);
    result[key] = value;
  }
  return result;
}
function binding(part, context) { return Object.fromEntries(BINDING_KEYS.filter((key) => has(part, key)).map((key) => [key, substitute(part[key], context)])); }
function axisValues(rep, datasets, periods) {
  const alias = rep.as;
  if (!alias || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) fail('Invalid repeat alias');
  let values;
  if (rep.by === 'values') {
    const ds = datasets[rep.source];
    if (!ds) fail(`Unknown repeat dataset: ${rep.source}`);
    if (!ds.columns.includes(rep.field)) fail(`Unknown repeat field: ${rep.field}`);
    values = [...new Set(ds.rows.map((row) => row[rep.field]).filter((value) => value !== null && value !== undefined))];
    if (rep.sort === undefined || rep.sort === 'asc') values.sort((a, b) => String(a).localeCompare(String(b)));
    else if (rep.sort === 'desc') values.sort((a, b) => String(b).localeCompare(String(a)));
    else if (rep.sort !== 'source') fail('Invalid repeat sort');
  } else if (rep.by === 'days') {
    if (!has(periods, rep.period)) fail(`Unknown repeated period: ${rep.period}`);
    const [start, end] = periods[rep.period];
    const length = (Date.parse(end) - Date.parse(start)) / 86400000 + 1;
    if (length > MAX_DAYS) fail('Daily expansion too long');
    values = Array.from({ length }, (_, i) => dateAdd(start, i));
  } else fail('Repeat by must be values or days');
  if (values.length > MAX_COLS) fail('Too many repeated columns');
  return [alias, values];
}
function expandHeaders(header, datasets, periods) {
  const axes = {}, expanded = [];
  for (const row of header) {
    const out = [];
    for (const item of row) {
      if (has(item, 'repeat')) {
        if ((item.rowspan || 1) !== 1 || (item.colspan || 1) !== 1) fail('Dynamic header with rowspan/colspan not supported');
        const [alias, values] = axisValues(item.repeat, datasets, periods);
        if (has(axes, alias) && JSON.stringify(axes[alias]) !== JSON.stringify(values)) fail(`Repeat alias conflict: ${alias}`);
        axes[alias] = values;
        for (const value of values) { const cell = copy(item); delete cell.repeat; cell._context = { [alias]: value }; out.push(cell); }
      } else out.push({ ...copy(item), _context: {} });
    }
    expanded.push(out);
  }
  if (!expanded.length) return [[], [], axes];
  const occupancy = new Map(), display = [];
  expanded.forEach((items, y) => {
    const entries = [];
    let x = 0;
    for (const item of items) {
      while (occupancy.has(`${y}:${x}`)) x++;
      const rowspan = item.rowspan ?? 1, colspan = item.colspan ?? 1;
      if (!Number.isInteger(rowspan) || !Number.isInteger(colspan) || rowspan < 1 || colspan < 1 || y + rowspan > expanded.length) fail('Bad header span');
      for (let yy = y; yy < y + rowspan; yy++) for (let xx = x; xx < x + colspan; xx++) {
        const key = `${yy}:${xx}`;
        if (occupancy.has(key)) fail('Overlapping header spans');
        occupancy.set(key, item);
      }
      entries.push({ label: substitute(item.label || '', item._context), rowspan, colspan, start: x, item });
      x += colspan;
    }
    display.push(entries);
  });
  const width = Math.max(...[...occupancy.keys()].map((key) => Number(key.split(':')[1]))) + 1;
  if (width > MAX_COLS) fail('Header has too many columns');
  for (let y = 0; y < expanded.length; y++) for (let x = 0; x < width; x++) if (!occupancy.has(`${y}:${x}`)) fail('Header has a hole');
  const leaves = [];
  for (let x = 0; x < width; x++) {
    const path = [];
    for (let y = 0; y < expanded.length; y++) {
      const item = occupancy.get(`${y}:${x}`);
      if (path.at(-1) !== item) path.push(item);
    }
    let context = {}, constraints = {}, key;
    for (const item of path) {
      context = merge(context, item._context);
      constraints = merge(constraints, binding(item, context));
      if (item.key !== undefined) key = substitute(item.key, context);
    }
    leaves.push({ key: String(key ?? x), context, binding: constraints, label: substitute(path.at(-1)?.label || '', context) });
  }
  if (new Set(leaves.map((leaf) => leaf.key)).size !== leaves.length) fail('Duplicate leaf-column keys');
  return [display, leaves, axes];
}
function expandCells(cells, axes) {
  const output = [];
  for (const cell of cells) {
    if (cell.repeat !== undefined) {
      if (!has(axes, cell.repeat)) fail(`Cell repeat has no matching header alias: ${cell.repeat}`);
      for (const value of axes[cell.repeat]) { const item = copy(cell); delete item.repeat; item._context = { [cell.repeat]: value }; output.push(item); }
    } else output.push({ ...copy(cell), _context: {} });
  }
  return output;
}

// Formula grammar accepts only literals, unary minus, arithmetic and named calls.
function evaluateFormula(input, functions) {
  if (input.length > 512) fail('Formula too long');
  const tokens = [];
  const pattern = /\s*(?:([A-Za-z_][A-Za-z0-9_]*)|(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|([()+\-*/,]))/gy;
  let position = 0;
  while (position < input.length) {
    pattern.lastIndex = position;
    const match = pattern.exec(input);
    if (!match) fail('Invalid formula syntax');
    position = pattern.lastIndex;
    tokens.push(match[1] ? { type: 'name', value: match[1] } : match[2] ? { type: 'number', value: Number(match[2]) } : match[3] ? { type: 'string', value: JSON.parse(match[3][0] === "'" ? `"${match[3].slice(1, -1).replaceAll('"', '\\"')}"` : match[3]) } : { type: match[4] });
    if (tokens.length > 80) fail('Formula too complex');
  }
  let index = 0;
  const peek = () => tokens[index];
  const take = (type) => { if (peek()?.type !== type) fail('Invalid formula syntax'); return tokens[index++]; };
  const atom = (depth) => {
    if (depth > 20) fail('Formula too complex');
    if (peek()?.type === '-') { take('-'); const value = atom(depth + 1); return value === null ? null : -number(value); }
    if (peek()?.type === '(') { take('('); const value = expression(0, depth + 1); take(')'); return value; }
    if (peek()?.type === 'number' || peek()?.type === 'string') return tokens[index++].value;
    if (peek()?.type === 'name') {
      const name = take('name').value;
      if (name === 'None') return null;
      if (!has(functions, name)) fail('Disallowed formula expression');
      take('('); const args = [];
      if (peek()?.type !== ')') { do { args.push(expression(0, depth + 1)); if (peek()?.type !== ',') break; take(','); } while (true); }
      take(')');
      if (args.length > 12) fail('Too many formula args');
      return functions[name](...args);
    }
    fail('Disallowed formula expression');
  };
  const precedence = { '+': 1, '-': 1, '*': 2, '/': 2 };
  const expression = (minimum, depth) => {
    let left = atom(depth);
    while (peek() && (precedence[peek().type] || 0) > minimum) {
      const operator = tokens[index++].type, right = expression(precedence[operator], depth + 1);
      const a = number(left), b = number(right);
      left = a === null || b === null ? null : operator === '+' ? a + b : operator === '-' ? a - b : operator === '*' ? a * b : b === 0 ? null : a / b;
    }
    return left;
  };
  const result = expression(0, 0);
  if (index !== tokens.length) fail('Invalid formula syntax');
  return result;
}

export function formatValue(value, spec = {}) {
  if (value === null || value === undefined) return '-';
  const type = spec.type || 'text', precision = spec.precision ?? 2;
  if (!['text', 'integer', 'number', 'currency', 'percent'].includes(type)) fail('Bad format type');
  if (type === 'text') return String(value);
  if (!Number.isInteger(precision) || precision < 0 || precision > 6) fail('Bad precision');
  const num = number(value);
  if (num === null) return '-';
  const formatted = (amount, digits) => amount.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  if (type === 'integer') return formatted(num, 0);
  if (type === 'percent') return `${formatted(num * 100, precision)}%`;
  if (type === 'currency') return `₹${formatted(num, precision)}`;
  return formatted(num, precision);
}

export class ReportEngine {
  constructor(datasets, today = '2026-10-13') {
    this.datasets = datasets; this.today = iso(today);
    for (const [id, ds] of Object.entries(datasets)) {
      if (!Array.isArray(ds.rows) || !Array.isArray(ds.columns)) fail(`Dataset must declare rows and columns: ${id}`);
      if (new Set(ds.columns).size !== ds.columns.length) fail(`Duplicate dataset field: ${id}`);
      if (!Array.isArray(ds.grain) || (!ds.grain.length && ds.rows.length > 1)) fail(`Dataset must declare a unique grain: ${id}`);
      if (ds.grain.some((field) => !ds.columns.includes(field))) fail(`Grain refers to unknown fields: ${id}`);
      const seen = new Set();
      for (const row of ds.rows) {
        if (!row || typeof row !== 'object' || Object.keys(row).some((field) => !ds.columns.includes(field))) fail(`Undeclared data fields: ${id}`);
        if (ds.grain.length) {
          const key = JSON.stringify(ds.grain.map((field) => row[field]));
          if (ds.grain.some((field) => row[field] === null || row[field] === undefined)) fail(`Null in dataset grain: ${id}`);
          if (seen.has(key)) fail(`Duplicate dataset grain: ${id}`);
          seen.add(key);
        }
      }
    }
  }
  source(id, field) {
    if (!has(this.datasets, id)) fail(`Unknown source: ${id}`);
    if (!this.datasets[id].columns.includes(field)) fail(`Unknown field ${field} in source ${id}`);
    return this.datasets[id].rows;
  }
  aggregate(id, field, where, period, periods, aggregate) {
    const records = this.source(id, field);
    if (Object.keys(where).some((key) => !this.datasets[id].columns.includes(key))) fail(`Filter fields not present in source ${id}`);
    const selected = records.filter((record) => {
      if (Object.entries(where).some(([key, value]) => record[key] !== value)) return false;
      if (period) {
        if (!has(periods, period)) fail(`Unknown period: ${period}`);
        if (!this.datasets[id].columns.includes('date')) fail(`Period used on dataset without date column: ${id}`);
        const [start, end] = periods[period];
        if (record.date === null || record.date === undefined || record.date < start || record.date > end) return false;
      }
      return true;
    });
    const values = selected.map((record) => record[field]);
    if (aggregate === 'none') { if (values.length > 1) fail(`Multiple records require aggregate: ${id}`); return values[0] ?? null; }
    if (aggregate === 'count') return values.filter((value) => value !== null && value !== undefined).length;
    const nums = values.filter((value) => value !== null && value !== undefined).map(number);
    if (!nums.length) return null;
    if (aggregate === 'sum') return nums.reduce((a, b) => a + b, 0);
    if (aggregate === 'avg') return nums.reduce((a, b) => a + b, 0) / nums.length;
    if (aggregate === 'min') return Math.min(...nums);
    if (aggregate === 'max') return Math.max(...nums);
    fail(`Invalid aggregate: ${aggregate}`);
  }
  table(table) {
    const periods = periodsFor(table, this.today);
    let [display, leaves, axes] = expandHeaders(table.header || [], this.datasets, periods);
    const cfg = table.rows || {};
    if (!['static', 'dynamic'].includes(cfg.mode) || !Array.isArray(cfg.data)) fail('Invalid rows configuration');
    const rows = [];
    for (const template of cfg.data) {
      if (cfg.mode === 'static' && template.repeat === 'records') fail('Static mode may not repeat dataset records');
      if (cfg.mode === 'dynamic' && !cfg.data.some((row) => row.repeat === 'records')) fail('Dynamic mode requires a records template');
      if (template.repeat === 'records') for (const cell of template.cells || []) if (cell.kind === 'field') this.source(template.source || cfg.source, cell.field);
    }
    for (const template of cfg.data) {
      if (template.repeat === 'records') {
        const src = template.source || cfg.source;
        if (!has(this.datasets, src)) fail('Missing dynamic source');
        if (!cfg.row_key?.length || cfg.row_key.some((key) => !this.datasets[src].columns.includes(key))) fail('row_key missing/unresolvable');
        let records = [...this.datasets[src].rows];
        if (template.sort) {
          const field = template.sort.field; this.source(src, field);
          records.sort((a, b) => (a[field] === null) - (b[field] === null) || (a[field] < b[field] ? -1 : a[field] > b[field] ? 1 : 0));
          if (template.sort.direction === 'desc') records.reverse();
        }
        if (template.limit !== undefined) { if (!Number.isInteger(template.limit) || template.limit <= 0) fail('limit must be positive integer'); records = records.slice(0, template.limit); }
        for (const rec of records) {
          const identity = cfg.row_key.map((key) => rec[key]);
          if (identity.some((value) => value === null || value === undefined)) fail('Null dynamic row identity');
          rows.push({ key: identity.join('|'), template, record: rec, record_source: src });
        }
      } else {
        if (template.repeat !== undefined) fail('Invalid row repeat');
        if (template.key === undefined) fail('Static row key required');
        rows.push({ key: template.key, template, record: null, record_source: null });
      }
    }
    if (rows.length > MAX_ROWS) fail('Too many rendered rows');
    if (new Set(rows.map((row) => row.key)).size !== rows.length) fail('Duplicate row identity');
    const rendered = [];
    for (const row of rows) {
      const cells = expandCells(row.template.cells || [], axes);
      if (!leaves.length) {
        if (rendered.length && cells.length !== rendered[0].cells.length) fail('Header-less rows have different widths');
        if (cells.length > MAX_COLS) fail('Too many cells');
      } else if (cells.length !== leaves.length) fail(`Column-count mismatch in row ${row.key}: expected ${leaves.length}, got ${cells.length}`);
      const output = [];
      for (let index = 0; index < cells.length; index++) {
        const cell = cells[index], header = leaves[index] || { key: String(index), context: {}, binding: {} };
        const context = merge(header.context, cell._context), recordContext = row.record || {};
        const resolveWhere = (object) => Object.fromEntries(Object.entries(object || {}).map(([key, value]) => {
          if (typeof value === 'string') {
            const match = /^\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(value);
            value = match && has({ ...recordContext, ...context }, match[1]) ? { ...recordContext, ...context }[match[1]] : substitute(value, { ...recordContext, ...context });
          }
          return [key, value];
        }));
        let where = merge(resolveWhere(row.template.where), resolveWhere(cell.where));
        for (const [axis, value] of Object.entries(context)) { if (has(where, axis) && where[axis] !== value) fail('Conflicting axis/row filter'); where[axis] = value; }
        let bound = merge(header.binding, binding(row.template, context), binding(cell, context));
        if (row.record && cell.kind === 'actual') {
          const raw = { ...(row.template.where || {}), ...(cell.where || {}) };
          const keyed = Object.values(raw).some((value) => typeof value === 'string' && (cfg.row_key || []).some((key) => value.includes(`{${key}}`)));
          if (!keyed) fail('Repeated row actual cells must explicitly filter by a row identity; use field kind for same-record values');
        }
        if (has(recordContext, 'segment')) {
          if (has(bound, 'segment') && bound.segment !== recordContext.segment) fail('Dynamic row/header segment conflict');
          bound = merge(bound, { segment: recordContext.segment });
        }
        if (has(bound, 'segment')) where = merge(where, { segment: bound.segment });
        output.push({ spec: cell, ctx: context, where, binding: bound, value: null, resolved: false, format: cell.format || {} });
      }
      rendered.push({ key: row.key, style: row.template.style || 'normal', record: row.record, record_source: row.record_source, cells: output });
    }
    if (!leaves.length) leaves = Array.from({ length: rendered[0]?.cells.length || 0 }, (_, index) => ({ key: String(index), label: '', context: {}, binding: {} }));
    if (rendered.length * leaves.length > MAX_CELLS) fail('Report exceeds cell limit');
    const cellIndex = new Map();
    for (const row of rendered) leaves.forEach((leaf, index) => cellIndex.set(JSON.stringify([String(row.key), leaf.key]), [row, index]));
    const running = new Set(), warnings = [];
    const resolve = (row, index) => {
      const key = JSON.stringify([String(row.key), leaves[index].key]), cell = row.cells[index];
      if (cell.resolved) return cell.value;
      if (running.has(key)) fail(`Circular formula reference: ${key}`);
      running.add(key);
      try {
        const spec = cell.spec, bound = cell.binding, rec = row.record, context = cell.ctx;
        let value;
        if (spec.kind === 'literal') {
          if (['source', 'metric', 'formula'].some((field) => has(spec, field))) fail('Literal has invalid binding');
          value = substitute(spec.text || '', { ...context, ...(rec || {}) });
        } else if (spec.kind === 'field') {
          if (!rec) fail('Field cell requires dynamic record');
          if (bound.source && bound.source !== row.record_source) fail('Field cell conflicts with header source');
          if (bound.metric && bound.metric !== spec.field) fail('Field cell conflicts with header metric');
          this.source(row.record_source, spec.field); value = rec[spec.field] ?? null;
        } else if (spec.kind === 'actual') {
          const src = bound.source || row.record_source, metric = bound.metric;
          if (!src || !metric) fail('Actual cell missing source/metric');
          value = rec && src === row.record_source && !Object.keys(cell.where).length && !bound.period && spec.aggregate === undefined
            ? rec[metric] ?? null : this.aggregate(src, metric, cell.where, bound.period, periods, spec.aggregate || 'none');
        } else if (spec.kind === 'calculated') {
          if (typeof spec.formula !== 'string') fail('Calculated cell requires formula string');
          const functions = {
            METRIC: (src, field, period) => this.aggregate(src, field, cell.where, period ?? bound.period, periods, 'sum'),
            FIELD: (field) => { if (!rec) fail('FIELD() requires record'); this.source(row.record_source, field); return rec[field] ?? null; },
            CELL: (rowKey, columnKey) => { const target = cellIndex.get(JSON.stringify([String(rowKey), String(columnKey)])); if (!target) fail('Unknown CELL reference'); return resolve(...target); },
            DIV: (a, b) => { a = number(a); b = number(b); if (b === 0) warnings.push(`Division by zero: ${key}`); return a === null || b === null || b === 0 ? null : a / b; },
            SUM: (...values) => { const nums = values.map(number).filter((value) => value !== null); return nums.length ? nums.reduce((a, b) => a + b, 0) : null; },
            COALESCE: (...values) => values.find((value) => value !== null && value !== undefined) ?? null,
            ABS: (value) => value === null ? null : Math.abs(number(value))
          };
          value = evaluateFormula(spec.formula, functions);
        } else fail(`Unknown cell kind: ${spec.kind}`);
        if (typeof value === 'number' && !Number.isFinite(value)) fail('Nonfinite result');
        cell.value = value; cell.resolved = true;
        return value;
      } finally { running.delete(key); }
    };
    for (const row of rendered) for (let index = 0; index < leaves.length; index++) resolve(row, index);
    return { id: table.id || 'table', header: display, leaves, rows: rendered, warnings };
  }
  render(config) {
    validateConfig(config);
    if (config.schema_version !== 1) fail('Expected schema_version 1');
    if (config.layout || config.blocks_direction || config.tables_direction) fail('Placement controls prohibited by frozen layout');
    if (!Array.isArray(config.blocks) || !config.blocks.length) fail('At least one block required');
    const built = [], ids = [];
    for (const block of config.blocks) {
      if (has(block, 'layout')) fail('Block layout override prohibited');
      ids.push(block.id);
      const tables = [], tableIds = new Set();
      for (const table of block.tables || []) {
        if (tableIds.has(table.id)) fail(`Duplicate table ID within block: ${table.id}`);
        tableIds.add(table.id);
        for (const row of table.rows?.data || []) for (const cell of row.cells || []) if (has(cell, 'rowspan') || has(cell, 'colspan')) fail('Body cell merge prohibited');
        tables.push(this.table(table));
      }
      built.push({ id: block.id, title: block.title || '', tables });
    }
    if (new Set(ids).size !== ids.length) fail('Duplicate block id');
    return { name: config.template_name || 'Report', blocks: built };
  }
}

export function compileReport(config, datasets, reportDate) {
  const result = new ReportEngine(datasets, reportDate).render(config);
  for (const block of result.blocks) for (const table of block.tables) for (const row of table.rows) for (const cell of row.cells) cell.display = formatValue(cell.value, cell.format);
  return result;
}
