import { request } from '/api-client.js';

const $ = (id) => document.getElementById(id);
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const title = (value) => String(value).replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const copy = (value) => JSON.parse(JSON.stringify(value));
let catalog;
let example;
let plan;
let sampleDatasets = [];
let savedConfigs = [];
let stage = 1;
let expandedSources = new Set();
let combinationOptions = [];
const templateGrouping = new Map();
const templateGuide = new Map();

function platform(id) { return catalog.platforms.find((item) => item.id === id); }
function source(id) { return plan.inputs.find((item) => item.id === id); }
function level(input) { return platform(input.platform).levels.find((item) => item.id === input.level); }
function sourceName(input) { return platform(input.platform).label + ' · ' + level(input).label; }
function ga4Preset(input) {
  const values = (input.filters?.find((filter) => filter.dimension === 'source_medium')?.values || []).map((value) => value.toLowerCase());
  if (!values.length) return 'all';
  if (values.join('|') === 'google / cpc|google/cpc') return 'google';
  if (values.includes('meta / metaads') || values.includes('facebook / paid')) return 'meta';
  return 'custom';
}
function uniqueId(base, used) {
  const stem = base.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'source';
  let value = stem, number = 2;
  while (used.includes(value)) value = stem + '_' + number++;
  return value;
}
function option(value, label, selected) {
  return '<option value="' + escape(value) + '"' + (value === selected ? ' selected' : '') + '>' + escape(label) + '</option>';
}
function options(items, selected) { return items.map((item) => option(item.value, item.label, selected)).join(''); }
function status(message, isError = false) {
  $('status').textContent = message;
  $('status').className = 'status' + (isError ? ' error' : '');
}
function suggestedKeys(leftId, rightId) {
  const left = referenceSpec(leftId), right = referenceSpec(rightId);
  const keys = [{ left: 'date', right: 'date' }];
  const pairs = [
    ['account_id', 'google_ads_customer_id', 'google_ads', 'ga4'],
    ['google_ads_customer_id', 'account_id', 'ga4', 'google_ads'],
    ['campaign_id', 'google_ads_campaign_id', 'google_ads', 'ga4'],
    ['google_ads_campaign_id', 'campaign_id', 'ga4', 'google_ads']
  ];
  for (const [a, b, firstPlatform, secondPlatform] of pairs) if (left.platform === firstPlatform && right.platform === secondPlatform && left.dimensions.includes(a) && right.dimensions.includes(b)) keys.push({ left: a, right: b });
  if (left.platform === right.platform) for (const field of ['account_id', 'campaign_id']) if (left.dimensions.includes(field) && right.dimensions.includes(field)) keys.push({ left: field, right: field });
  return keys;
}
function renderPlatforms() {
  $('breakdown').innerHTML = catalog.breakdowns.map((value) => '<label class="segment"><input type="radio" name="breakdown" data-field="breakdown" value="' + escape(value) + '"' + (plan.breakdown === value ? ' checked' : '') + '><span>' + title(value) + '</span></label>').join('');
  $('platformGrid').innerHTML = catalog.platforms.map((item) => {
    const count = plan.inputs.filter((input) => input.platform === item.id).length;
    return '<button type="button" class="platform-card' + (count ? ' selected' : '') + '" data-action="add-source" data-platform="' + escape(item.id) + '"><span class="platform-icon ' + escape(item.id) + '">' + escape(item.label[0]) + '</span><strong>' + escape(item.label) + '</strong><small>' + (count ? count + ' added · add another +' : '+ Add platform') + '</small></button>';
  }).join('');
  $('sourceCountLabel').textContent = plan.inputs.length + ' stream' + (plan.inputs.length === 1 ? '' : 's') + ' selected';
}
function renderSources() {
  $('sourceList').innerHTML = plan.inputs.map((input) => {
    const p = platform(input.platform), shape = level(input), expanded = expandedSources.has(input.id);
    const dimensions = shape.dimensions.map((name) => '<label class="chip"><input type="checkbox" data-field="dimension" data-id="' + escape(input.id) + '" value="' + escape(name) + '"' + (input.dimensions.includes(name) ? ' checked' : '') + (name === 'date' ? ' disabled' : '') + '>' + escape(title(name)) + '</label>').join('');
    const metrics = shape.metrics.map((name) => '<label class="chip"><input type="checkbox" data-field="metric" data-id="' + escape(input.id) + '" value="' + escape(name) + '"' + (input.metrics.includes(name) ? ' checked' : '') + '>' + escape(title(name)) + '</label>').join('');
    const filters = (input.filters || []).map((filter, index) => '<div class="filter-row"><select class="select" data-field="filter-dimension" data-id="' + escape(input.id) + '" data-index="' + index + '">' + options(input.dimensions.map((name) => ({ value: name, label: title(name) })), filter.dimension) + '</select><input class="text-input" data-field="filter-values" data-id="' + escape(input.id) + '" data-index="' + index + '" value="' + escape(filter.values.join(', ')) + '" aria-label="Filter values, comma separated"><button type="button" class="tiny danger" data-action="remove-filter" data-id="' + escape(input.id) + '" data-index="' + index + '">×</button></div>').join('');
    const ga4Choice = input.platform === 'ga4' ? '<label class="field" style="margin-top:14px"><span>Which GA4 traffic should this stream include?</span><select data-field="ga4-preset" data-id="' + escape(input.id) + '">' + options([{ value: 'all', label: 'All traffic' }, { value: 'google', label: 'Google paid · google / cpc' }, { value: 'meta', label: 'Meta paid · meta / metaads' }, { value: 'custom', label: 'Custom filter below' }], ga4Preset(input)) + '</select></label><div class="hint" style="margin-top:6px">Use separate filtered GA4 streams when Google and Meta need different channels.</div>' : '';
    return '<article class="source-card"><div class="source-card-top"><div class="source-title"><span class="platform-icon ' + escape(input.platform) + '">' + escape(p.label[0]) + '</span>' + escape(sourceName(input)) + '<span class="tag">' + escape(input.id) + '</span></div><div class="row"><button type="button" class="tiny" data-action="toggle-source" data-id="' + escape(input.id) + '">' + (expanded ? 'Done' : 'Edit') + '</button><button type="button" class="tiny danger" data-action="remove-source" data-id="' + escape(input.id) + '">Remove</button></div></div><div class="source-summary">' + escape(shape.label) + ' · ' + input.metrics.length + ' metrics · ' + input.dimensions.length + ' dimensions' + (input.filters?.length ? ' · ' + input.filters.length + ' filter' : '') + '</div>' +
      '<div class="source-body"' + (expanded ? '' : ' hidden') + '><div class="source-controls"><label class="field"><span>Data level</span><select data-field="level" data-id="' + escape(input.id) + '">' + options(p.levels.map((item) => ({ value: item.id, label: item.label })), input.level) + '</select></label></div>' + ga4Choice +
      '<div class="choice"><span class="label">Dimensions</span><div class="chips">' + dimensions + '</div></div><div class="choice"><span class="label">Metrics</span><div class="chips">' + metrics + '</div></div>' +
      '<div class="filter-box"><div class="row" style="justify-content:space-between"><span class="label">Filter this stream</span><button type="button" class="tiny" data-action="add-filter" data-id="' + escape(input.id) + '">+ Add filter</button></div>' + (filters || '<div class="hint" style="margin-top:6px">All matching rows are included.</div>') + '</div></div></article>';
  }).join('') || '<div class="empty">Choose a platform card above to add your first source.</div>';
}
function combination(id) { return plan.combinations.find((item) => item.id === id); }
function referenceSpec(id) {
  const direct = source(id);
  if (direct) return direct;
  const item = combination(id);
  if (!item) return null;
  const members = item.inputs.map(referenceSpec).filter(Boolean);
  if (!members.length) return null;
  const dimensions = item.operation === 'align' ? item.group_by || [] : item.operation === 'match' ? (item.keys || []).map((key) => key.left) : item.operation === 'append' ? ['source', ...members.slice(1).reduce((fields, input) => fields.filter((field) => input.dimensions.includes(field)), [...members[0].dimensions])] : [...members[0].dimensions];
  const metrics = [...new Set(members.flatMap((input) => input.metrics))];
  return { id, platform: 'combination', dimensions, metrics };
}
function referenceName(input) { return input.platform === 'combination' ? 'Combined · ' + (combination(input.id)?.label || input.id) : sourceName(input); }
function availableReferences(item) {
  const index = plan.combinations.indexOf(item);
  return [...plan.inputs, ...plan.combinations.slice(0, index).map((previous) => referenceSpec(previous.id)).filter(Boolean)];
}
function comboSources(item) { return item.inputs.map(referenceSpec).filter(Boolean); }
function comboDimensions(item) {
  const members = comboSources(item);
  return members.length ? members.slice(1).reduce((fields, input) => fields.filter((field) => input.dimensions.includes(field)), [...members[0].dimensions]) : [];
}
function comboMetricChoices(item) {
  const choices = new Map();
  for (const input of comboSources(item)) for (const metric of input.metrics) {
    if (!choices.has(metric)) choices.set(metric, []);
    choices.get(metric).push(input.id);
  }
  return choices;
}
function optionSources(item) {
  if (item.id === 'ga4') return plan.inputs.filter((input) => input.platform === 'ga4').map((input) => input.id);
  const taken = new Set();
  return item.eligible_inputs.map((wanted) => {
    const direct = source(wanted);
    const compatibleDirect = direct && (!wanted.startsWith('ga4_') || ga4Preset(direct) === wanted.slice(4)) ? direct : null;
    const candidate = compatibleDirect || plan.inputs.find((input) => !taken.has(input.id) && input.platform === (wanted.startsWith('ga4_') ? 'ga4' : wanted === 'google' ? 'google_ads' : wanted === 'meta' ? 'meta_ads' : 'shopify') && (!wanted.startsWith('ga4_') || ga4Preset(input) === wanted.slice(4)));
    if (candidate) taken.add(candidate.id);
    return candidate?.id;
  }).filter(Boolean);
}
function optionReady(item, ids) {
  return item.id === 'ga4' ? ids.length > 0 : ids.length === item.eligible_inputs.length;
}
function groupingUsable(item, grouping, ids) {
  if (!optionReady(item, ids)) return false;
  if (item.id === 'google_ga4' && grouping.by.join('|') === 'date|google_customer_id|google_campaign_id') {
    return ids.length === 2 && suggestedKeys(ids[0], ids[1]).length === 3;
  }
  return grouping.availability === 'current' && grouping.metric_coverage !== 'partial' && ids.every((id) => grouping.by.every((field) => field === 'platform' || source(id)?.dimensions.includes(field)));
}
function renderCombinationTemplates() {
  $('combinationTemplates').innerHTML = combinationOptions.map((item) => {
    const ids = optionSources(item), ready = optionReady(item, ids);
    const selected = Math.min(templateGrouping.get(item.id) || 0, item.possible_groupings.length - 1);
    const names = item.platforms.map((id) => platform(id)?.label || title(id)).join(' + ');
    const groupings = item.possible_groupings.map((grouping, index) => '<label class="template-grouping"><input type="radio" name="grouping-' + escape(item.id) + '" data-field="template-grouping" data-id="' + escape(item.id) + '" value="' + index + '"' + (selected === index ? ' checked' : '') + '><span><strong>' + escape(grouping.by.map(title).join(' + ')) + '</strong><small>' + escape(grouping.note) + (grouping.metric_coverage !== 'all' ? ' · ' + escape(title(grouping.metric_coverage)) + ' metrics' : '') + '</small></span><em class="template-badge ' + escape(grouping.availability) + '">' + escape({ current: 'Fields available', conditional: 'Needs mapping', extended: 'Needs more fields' }[grouping.availability]) + '</em></label>').join('');
    const usable = groupingUsable(item, item.possible_groupings[selected], ids);
    return '<details class="template-card' + (ready ? ' ready' : '') + '"><summary><span><strong>' + escape(names) + '</strong><small>' + item.possible_groupings.length + ' grouping options · ' + escape(ids.join(', ') || 'No matching streams') + '</small></span><em class="template-badge ' + (ready ? '' : 'conditional') + '">' + (ready ? 'Ready to configure' : 'Add sources first') + '</em></summary><div class="template-body">' + groupings + '<div class="template-actions"><small data-template-help>' + (usable ? 'Complete and validate the relationship below.' : ready ? 'This grouping needs verified mapping, more fields, or full metric coverage.' : 'Select the required platforms and GA4 traffic filters in Step 1.') + '</small><button type="button" class="tiny" data-action="use-template" data-id="' + escape(item.id) + '"' + (usable ? '' : ' disabled') + '>Use this option</button></div></div></details>';
  }).join('');
}
function syncCombinations() {
  plan.combinations ||= [];
  const ids = new Set(plan.inputs.map((input) => input.id));
  for (const item of plan.combinations) {
    item.inputs = (item.inputs || []).filter((id, index, list) => ids.has(id) && list.indexOf(id) === index);
    if (item.operation === 'independent') item.inputs = item.inputs.slice(0, 1);
    if (item.operation === 'match') item.inputs = item.inputs.slice(0, 2);
    item.keys = (item.keys || []).filter((key) => item.inputs.length === 2 && referenceSpec(item.inputs[0])?.dimensions.includes(key.left) && referenceSpec(item.inputs[1])?.dimensions.includes(key.right));
    item.group_by = (item.group_by || ['date']).filter((field) => comboDimensions(item).includes(field));
    if (item.operation === 'align' && !item.group_by.length && comboDimensions(item).includes('date')) item.group_by = ['date'];
    item.traffic_scope ||= {};
    for (const id of Object.keys(item.traffic_scope)) if (!item.inputs.includes(id) || source(id)?.platform !== 'ga4') delete item.traffic_scope[id];
    for (const input of comboSources(item)) if (input.platform === 'ga4' && !item.traffic_scope[input.id]) {
      const filtered = input.filters?.find((filter) => filter.dimension === 'source_medium')?.values || [];
      item.traffic_scope[input.id] = filtered.length ? { mode: 'values', values: [...filtered] } : { mode: 'all', values: [] };
    }
    item.metric_sources ||= {};
    const choices = comboMetricChoices(item);
    for (const metric of Object.keys(item.metric_sources)) if (!choices.get(metric)?.includes(item.metric_sources[metric])) delete item.metric_sources[metric];
    if (item.operation === 'match' || item.operation === 'align') for (const [metric, candidates] of choices) if (candidates.length === 1) item.metric_sources[metric] = candidates[0];
    ids.add(item.id);
  }
}
function comboSourceOptions(item, selected, excluded = []) {
  return option('', 'Choose a source', selected) + options(availableReferences(item).filter((input) => !excluded.includes(input.id) || input.id === selected).map((input) => ({ value: input.id, label: referenceName(input) + ' · ' + input.id })), selected);
}
function renderCombinations() {
  syncCombinations();
  $('combinationList').innerHTML = plan.combinations.map((item, number) => {
    const members = comboSources(item);
    const inputs = item.inputs.map((id, index) => '<div class="row"><label class="field grow"><span>' + (index === 0 ? 'First source' : 'Add source') + '</span><select data-field="combo-input" data-id="' + escape(item.id) + '" data-index="' + index + '">' + comboSourceOptions(item, id, item.inputs.filter((_, i) => i !== index)) + '</select></label>' + (item.inputs.length > (item.operation === 'independent' ? 1 : 2) ? '<button type="button" class="tiny danger" data-action="remove-combo-input" data-id="' + escape(item.id) + '" data-index="' + index + '">Remove</button>' : '') + '</div>').join('');
    const keyRows = item.operation === 'match' && members.length === 2 ? item.keys.map((key, index) => '<div class="match-row"><select class="select" data-field="combo-key-left" data-id="' + escape(item.id) + '" data-index="' + index + '">' + options(members[0].dimensions.map((name) => ({ value: name, label: title(name) })), key.left) + '</select><select class="select" data-field="combo-key-right" data-id="' + escape(item.id) + '" data-index="' + index + '">' + options(members[1].dimensions.map((name) => ({ value: name, label: title(name) })), key.right) + '</select><button type="button" class="tiny danger" data-action="remove-combo-key" data-id="' + escape(item.id) + '" data-index="' + index + '">×</button></div>').join('') : '';
    const dimensions = item.operation === 'align' ? '<div class="choice"><span class="label">Align on shared data fields</span><div class="chips">' + comboDimensions(item).map((field) => '<label class="chip"><input type="checkbox" data-field="combo-grain" data-id="' + escape(item.id) + '" value="' + escape(field) + '"' + (item.group_by.includes(field) ? ' checked' : '') + '>' + escape(title(field)) + '</label>').join('') + '</div><div class="combo-help">Each source is summed to these fields before metrics are aligned. Choose fields that describe the same thing in every source.</div></div>' : '';
    const ga4Scopes = members.filter((input) => input.platform === 'ga4' && input.dimensions.includes('source_medium')).map((input) => {
      const scope = item.traffic_scope[input.id];
      return '<div class="combo-note"><label class="field"><span>GA4 traffic from ' + escape(input.id) + '</span><select data-field="combo-traffic-mode" data-id="' + escape(item.id) + '" data-source="' + escape(input.id) + '">' + options([{ value: 'all', label: 'All traffic in this stream' }, { value: 'values', label: 'Only selected source / medium values' }], scope.mode) + '</select></label>' + (scope.mode === 'values' ? '<label class="field" style="margin-top:9px"><span>Source / medium values (comma separated; add as many as needed)</span><input data-field="combo-traffic-values" data-id="' + escape(item.id) + '" data-source="' + escape(input.id) + '" value="' + escape(scope.values.join(', ')) + '" placeholder="google / cpc, google/cpc"></label>' : '') + '<div class="combo-help">This relationship selects GA4 traffic; Step 1 source filters still apply first.</div></div>';
    }).join('');
    const suppliers = item.operation === 'match' || item.operation === 'align' ? '<div class="choice"><span class="label">Metric supplier</span><div class="supplier-grid">' + [...comboMetricChoices(item)].map(([metric, candidates]) => '<label class="field"><span>' + escape(title(metric)) + ' from</span><select data-field="combo-metric" data-id="' + escape(item.id) + '" data-metric="' + escape(metric) + '">' + option('', 'Choose source', item.metric_sources[metric]) + options(candidates.map((id) => ({ value: id, label: referenceName(referenceSpec(id)) + ' · ' + id })), item.metric_sources[metric]) + '</select></label>').join('') + '</div></div>' : '';
    const settings = item.operation === 'match' ? '<div class="choice"><span class="label">Match fields</span><div class="match-head"><span class="label">First source</span><span class="label">Second source</span><span></span></div>' + keyRows + '<button type="button" class="tiny" data-action="add-combo-key" data-id="' + escape(item.id) + '">+ Add match field</button><div class="combo-help">Both sources are aggregated on these keys before matching. Campaign IDs from different ad platforms are not equivalent.</div></div><label class="field" style="margin-top:13px"><span>Keep which records?</span><select data-field="combo-join" data-id="' + escape(item.id) + '">' + options([{ value: 'left', label: 'All first-source rows' }, { value: 'inner', label: 'Only matching rows' }, { value: 'full', label: 'All rows from both sources' }], item.join_type || 'left') + '</select></label>' : dimensions;
    const warnings = [];
    if (item.operation === 'match' && item.keys.length === 1 && item.keys[0].left === 'date' && item.keys[0].right === 'date') warnings.push('Date-only match combines totals by date. It cannot preserve campaign detail.');
    if (members.some((input) => input.platform === 'ga4' && item.traffic_scope[input.id]?.mode === 'all') && members.some((input) => ['google_ads', 'meta_ads'].includes(input.platform))) warnings.push('All GA4 traffic is selected. Choose source / medium values if this combination represents one paid platform.');
    return '<article class="combination-card"><div class="combo-top"><h3>' + (number + 1) + ' · ' + escape(item.label || 'New combination') + '</h3><button type="button" class="tiny danger" data-action="remove-combination" data-id="' + escape(item.id) + '">Remove</button></div>' + (templateGuide.has(item.id) ? '<div class="combo-note">Selected grouping: ' + escape(templateGuide.get(item.id).by.map(title).join(' + ')) + '. ' + escape(templateGuide.get(item.id).note) + ' This is guidance until the relationship below is valid.</div>' : '') + '<div class="combo-grid"><label class="field"><span>Combination name</span><input data-field="combo-label" data-id="' + escape(item.id) + '" value="' + escape(item.label || '') + '" maxlength="80" placeholder="e.g. Google campaign performance"></label><label class="field"><span>How should data combine?</span><select data-field="combo-operation" data-id="' + escape(item.id) + '">' + option('', 'Choose an operation', item.operation) + options([{ value: 'independent', label: 'Keep source independent' }, { value: 'append', label: 'Append rows from sources' }, { value: 'match', label: 'Match records by fields' }, { value: 'align', label: 'Align metrics at common grain' }], item.operation) + '</select></label><div class="combo-wide combo-grid">' + inputs + '</div></div>' + (['append', 'align'].includes(item.operation) ? '<div class="row" style="margin-top:10px"><select class="select" style="max-width:310px" data-add-source="' + escape(item.id) + '" aria-label="Source to add">' + option('', 'Choose another source', '') + options(availableReferences(item).filter((input) => !item.inputs.includes(input.id)).map((input) => ({ value: input.id, label: referenceName(input) + ' · ' + input.id })), '') + '</select><button type="button" class="tiny" data-action="add-combo-input" data-id="' + escape(item.id) + '">+ Add source</button></div>' : '') + '<div class="combo-help">' + escape({ independent: 'This source stays available on its own.', append: 'Rows are stacked with source identity retained. Missing metrics stay empty.', match: 'Matching records become one output; choose fields that identify the same entity.', align: 'Metrics are grouped by shared fields, then placed together.' }[item.operation] || 'Choose the relationship that fits your data.') + '</div>' + settings + ga4Scopes + suppliers + warnings.map((message) => '<div class="warning">' + escape(message) + '</div>').join('') + '</article>';
  }).join('') || '<div class="empty">No combination yet. Your selected sources remain independent until you add one.</div>';
}
function renderCombinationPreview() {
  const used = new Set(plan.combinations.flatMap((item) => item.inputs));
  const items = [...plan.combinations.map((item) => ({ label: item.label || item.id, detail: title(item.operation) + ' · ' + item.inputs.join(' + '), grain: item.operation === 'match' ? item.keys.map((key) => key.left).join(' + ') : item.operation === 'align' ? item.group_by.join(' + ') : 'Source identity retained' })), ...plan.inputs.filter((input) => !used.has(input.id)).map((input) => ({ label: sourceName(input), detail: 'Independent · ' + input.id, grain: input.dimensions.join(' + ') }))];
  $('outputPreview').innerHTML = items.length ? '<div class="combo-preview">' + items.map((item) => '<div><strong>' + escape(item.label) + '</strong><small>' + escape(item.detail) + '<br>Data grain: ' + escape(item.grain || 'Choose fields') + '</small></div>').join('') + '</div>' : '<div class="empty">Add a platform to see the output plan.</div>';
}
function renderCombinationSummary() {
  const count = new Set(plan.inputs.map((input) => input.platform)).size;
  $('summaryCounts').innerHTML = '<div><strong>' + count + '</strong><small>Platforms</small></div><div><strong>' + plan.inputs.length + '</strong><small>Streams</small></div><div><strong>' + plan.combinations.length + '</strong><small>Combinations</small></div>';
  $('flow').innerHTML = '<div class="flow-row"><strong>1 · Selected data</strong><small>' + escape(plan.inputs.map((input) => sourceName(input)).join(', ') || 'Choose platforms') + '</small></div><div class="flow-arrow">↓</div><div class="flow-row"><strong>2 · Source relationships</strong><small>' + escape(plan.combinations.map((item) => (item.label || item.id) + ' · ' + title(item.operation)).join('; ') || 'Sources remain independent') + '</small></div>';
}
function upgradeLegacyCombinations() {
  if (Array.isArray(plan.combinations)) return;
  plan.combinations = [];
  if (plan.merges?.length) plan.combinations = plan.merges.map((entry) => ({ id: entry.id, label: title(entry.id), operation: 'match', inputs: [entry.left, entry.right], keys: copy(entry.keys), join_type: entry.join_type, group_by: ['date'], traffic_scope: {}, metric_sources: copy(entry.metric_sources || {}) }));
  else if (plan.composition?.channels?.length) plan.combinations = plan.composition.channels.map((entry) => ({ id: uniqueId('combined_' + entry.id, [...plan.inputs.map((input) => input.id), ...plan.combinations.map((item) => item.id)]), label: entry.label, operation: entry.inputs.length > 1 ? 'align' : 'independent', inputs: [...entry.inputs], keys: [], join_type: 'left', group_by: ['date'], traffic_scope: {}, metric_sources: Object.fromEntries(Object.entries(entry.metric_sources || {}).map(([metric, supplier]) => [metric, supplier.input])) }));
}
function renderSaved() {
  const configs = savedConfigs.filter((item) => item.sourceCount);
  $('saved').innerHTML = configs.length ? configs.map((item) => '<button type="button" data-action="load-saved" data-id="' + escape(item.id) + '"><strong>' + escape(item.name) + '</strong><small>' + item.sourceCount + ' streams · ' + escape(item.breakdown || 'day') + ' · ' + escape(new Date(item.createdAt).toLocaleDateString()) + '</small></button>').join('') : '<div class="empty">No source config saved yet.</div>';
}
function render() {
  if (!plan || !catalog) return;
  syncCombinations();
  $('stepOne').hidden = stage !== 1;
  $('stepTwo').hidden = stage !== 2;
  document.querySelectorAll('.step-link').forEach((button) => button.classList.toggle('active', Number(button.dataset.step) === stage));
  renderPlatforms();
  renderSources();
  renderCombinationTemplates();
  renderCombinations();
  renderCombinationPreview();
  renderCombinationSummary();
}
function newSource(platformId) {
  const p = platform(platformId), shape = platformId === 'ga4' ? p.levels.find((item) => item.id === 'session_source_medium') : p.levels[0];
  return { id: uniqueId(platformId.replace('_ads', ''), plan.inputs.map((input) => input.id)), platform: platformId, account_refs: [p.accounts[0].ref], level: shape.id, dimensions: [...shape.dimensions], metrics: [...shape.metrics] };
}
function handleAction(button) {
  const action = button.dataset.action, id = button.dataset.id, index = Number(button.dataset.index);
  if (action === 'go-step' || action === 'continue') {
    const next = action === 'continue' ? 2 : Number(button.dataset.step);
    if (next === 2 && !plan.inputs.length) return status('Add at least one platform first.', true);
    stage = next;
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  if (action === 'add-source') {
    const input = newSource(button.dataset.platform);
    plan.inputs.push(input);
    expandedSources = new Set([input.id]);
  }
  if (action === 'load-example') {
    plan = copy(example);
    upgradeLegacyCombinations();
    expandedSources = new Set([plan.inputs[0]?.id]);
    $('configName').value = 'Cross-platform daily performance';
    status('Sample setup loaded. You can edit every source.');
  }
  if (action === 'toggle-source') {
    if (expandedSources.has(id)) expandedSources.delete(id);
    else expandedSources.add(id);
  }
  if (action === 'remove-source') { plan.inputs = plan.inputs.filter((input) => input.id !== id); expandedSources.delete(id); }
  if (action === 'add-filter') {
    const input = source(id);
    input.filters ||= [];
    input.filters.push({ dimension: input.dimensions.includes('source_medium') ? 'source_medium' : input.dimensions[0], operator: 'in', values: ['value'] });
  }
  if (action === 'remove-filter') source(id).filters.splice(index, 1);
  if (action === 'add-combination') {
    if (!plan.inputs.length) return status('Add a source first.', true);
    const inputs = plan.inputs.slice(0, Math.min(2, plan.inputs.length)).map((input) => input.id);
    plan.combinations.push({ id: uniqueId('combination', [...plan.inputs.map((input) => input.id), ...plan.combinations.map((item) => item.id)]), label: '', operation: '', inputs: inputs.slice(0, 1), keys: [], join_type: 'left', group_by: ['date'], traffic_scope: {}, metric_sources: {} });
  }
  if (action === 'use-template') {
    const item = combinationOptions.find((option) => option.id === id);
    if (!item) return;
    const ids = optionSources(item);
    const grouping = item.possible_groupings[templateGrouping.get(id) || 0];
    if (!groupingUsable(item, grouping, ids)) return status('This grouping needs more source fields or a verified mapping.', true);
    const comboId = uniqueId('combined_' + id, [...plan.inputs.map((input) => input.id), ...plan.combinations.map((entry) => entry.id)]);
    const campaignMatch = id === 'google_ga4' && grouping.by.length === 3;
    const operation = ids.length === 1 ? 'independent' : campaignMatch ? 'match' : grouping.metric_coverage === 'source_separated' || ['google_meta', 'ga4'].includes(id) ? 'append' : ids.length === 2 && grouping.by.length === 1 ? 'align' : '';
    plan.combinations.push({ id: comboId, label: item.platforms.map((platformId) => platform(platformId)?.label || title(platformId)).join(' + '), operation, inputs: ids, keys: campaignMatch ? suggestedKeys(...ids) : [], join_type: 'left', group_by: grouping.by.every((field) => ids.every((sourceId) => source(sourceId)?.dimensions.includes(field))) ? [...grouping.by] : ['date'], traffic_scope: {}, metric_sources: {} });
    templateGuide.set(comboId, grouping);
    status('Option added below. Complete its relationship and metric supplier choices before saving.');
  }
  if (action === 'remove-combination') plan.combinations = plan.combinations.filter((item) => item.id !== id);
  if (action === 'add-combo-input') {
    const item = combination(id), selected = document.querySelector('[data-add-source="' + id + '"]')?.value;
    if (!selected) return status('Choose the source to add.', true);
    if (!availableReferences(item).some((input) => input.id === selected) || item.inputs.includes(selected)) return status('Choose another available source.', true);
    item.inputs.push(selected);
  }
  if (action === 'remove-combo-input') combination(id).inputs.splice(index, 1);
  if (action === 'add-combo-key') {
    const item = combination(id), [left, right] = comboSources(item);
    if (!left || !right) return status('Choose two sources first.', true);
    const a = left.dimensions.find((field) => !item.keys.some((key) => key.left === field));
    const b = right.dimensions.find((field) => !item.keys.some((key) => key.right === field));
    if (!a || !b) return status('No more match fields available.', true);
    item.keys.push({ left: a, right: b });
  }
  if (action === 'remove-combo-key') combination(id).keys.splice(index, 1);
  if (action === 'load-saved') {
    request('/api/configs/' + encodeURIComponent(id)).then(({ config }) => {
      if (!config.sourceConfig) return status('This older config has no source setup.', true);
      plan = copy(config.sourceConfig);
      upgradeLegacyCombinations();
      delete plan.result;
      expandedSources = new Set([plan.inputs[0]?.id]);
      $('configName').value = config.name + ' copy';
      stage = 1;
      render();
      status('Loaded ' + config.name + '. Save to create a new copy.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }).catch((error) => status(error.message, true));
    return;
  }
  render();
}
function handleChange(element) {
  const field = element.dataset.field, id = element.dataset.id, index = Number(element.dataset.index);
  const input = source(id), combo = plan.combinations?.find((entry) => entry.id === id);
  if (field === 'template-grouping') {
    templateGrouping.set(id, Number(element.value));
    const item = combinationOptions.find((option) => option.id === id);
    const usable = groupingUsable(item, item.possible_groupings[Number(element.value)], optionSources(item));
    const card = element.closest('.template-card');
    card.querySelector('[data-action="use-template"]').disabled = !usable;
    card.querySelector('[data-template-help]').textContent = usable ? 'Complete and validate the relationship below.' : 'This grouping needs verified mapping, more fields, or full metric coverage.';
    return;
  }
  if (field === 'breakdown') plan.breakdown = element.value;
  if (field === 'level') {
    input.level = element.value;
    input.dimensions = [...level(input).dimensions];
    input.metrics = [...level(input).metrics];
    input.filters = [];
  }
  if (field === 'dimension') input.dimensions = element.checked ? [...input.dimensions, element.value] : input.dimensions.filter((name) => name !== element.value);
  if (field === 'metric') input.metrics = element.checked ? [...input.metrics, element.value] : input.metrics.filter((name) => name !== element.value);
  if (field === 'filter-dimension') input.filters[index].dimension = element.value;
  if (field === 'filter-values') input.filters[index].values = element.value.split(',').map((part) => part.trim()).filter(Boolean);
  if (field === 'ga4-preset') {
    input.filters = (input.filters || []).filter((filter) => filter.dimension !== 'source_medium');
    if (element.value === 'google') input.filters.push({ dimension: 'source_medium', operator: 'in', values: ['google / cpc', 'google/cpc'] });
    if (element.value === 'meta') input.filters.push({ dimension: 'source_medium', operator: 'in', values: ['meta / metaads', 'facebook / paid'] });
    if (element.value === 'custom') { input.filters.push({ dimension: 'source_medium', operator: 'in', values: [''] }); status('Enter your source / medium value in the custom filter below.'); }
  }
  if (field === 'combo-label') combo.label = element.value.trim();
  if (field === 'combo-operation') {
    combo.operation = element.value;
    if (combo.operation === 'independent') combo.inputs = combo.inputs.slice(0, 1);
    else if (combo.inputs.length < 2) {
      const next = availableReferences(combo).find((entry) => !combo.inputs.includes(entry.id));
      if (next) combo.inputs.push(next.id);
    }
    combo.keys = combo.operation === 'match' && combo.inputs.length === 2 ? suggestedKeys(...combo.inputs) : [];
    combo.metric_sources = {};
  }
  if (field === 'combo-input') {
    combo.inputs[index] = element.value;
    combo.keys = combo.operation === 'match' && combo.inputs.length === 2 ? suggestedKeys(...combo.inputs) : [];
    combo.metric_sources = {};
  }
  if (field === 'combo-key-left') combo.keys[index].left = element.value;
  if (field === 'combo-key-right') combo.keys[index].right = element.value;
  if (field === 'combo-join') combo.join_type = element.value;
  if (field === 'combo-grain') combo.group_by = element.checked ? [...combo.group_by, element.value] : combo.group_by.filter((value) => value !== element.value);
  if (field === 'combo-metric') { if (element.value) combo.metric_sources[element.dataset.metric] = element.value; else delete combo.metric_sources[element.dataset.metric]; }
  if (field === 'combo-traffic-mode') { combo.traffic_scope[element.dataset.source].mode = element.value; if (element.value === 'values' && !combo.traffic_scope[element.dataset.source].values.length) combo.traffic_scope[element.dataset.source].values = ['']; }
  if (field === 'combo-traffic-values') combo.traffic_scope[element.dataset.source].values = element.value.split(',').map((value) => value.trim()).filter(Boolean);
  render();
}
function sampleSelections() {
  const lookup = { google_ads: 'perf_google', meta_ads: 'perf_meta', ga4: 'perf_ga4', shopify: 'perf_shopify' };
  const available = new Set(sampleDatasets.flatMap((item) => item.metrics.map((metric) => item.id + ':' + metric)));
  const selected = new Set();
  for (const input of plan.inputs) for (const metric of input.metrics) {
    const key = lookup[input.platform] + ':' + metric;
    if (available.has(key)) selected.add(key);
  }
  return [...selected].map((key) => {
    const [sourceId, metric] = key.split(':');
    return { source: sourceId, metric };
  });
}
document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (button) handleAction(button);
});
document.addEventListener('change', (event) => {
  if (event.target.dataset.field) handleChange(event.target);
});
$('configForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  status('');
  const name = $('configName').value.trim();
  if (!name) return status('Give the config a name.', true);
  $('saveButton').disabled = true;
  try {
    const sourceConfig = { contract_version: 1, breakdown: plan.breakdown, inputs: plan.inputs, combinations: plan.combinations };
    const { config } = await request('/api/configs', { method: 'POST', body: JSON.stringify({ name, selections: sampleSelections(), sourceConfig }) });
    savedConfigs = (await request('/api/configs')).configs;
    renderSaved();
    status('Saved ' + config.name + '. You can load it from the list.');
  } catch (error) {
    status(error.message, true);
  } finally {
    $('saveButton').disabled = false;
  }
});
async function load() {
  try {
    const [sourceResponse, datasetResponse, configResponse] = await Promise.all([
      request('/api/source-config/catalog'), request('/api/datasets/catalog'), request('/api/configs')
    ]);
    catalog = sourceResponse.catalog;
    example = sourceResponse.example;
    combinationOptions = sourceResponse.combinationOptions || [];
    plan = { contract_version: 1, breakdown: 'day', inputs: [], combinations: [] };
    sampleDatasets = datasetResponse.datasets;
    savedConfigs = configResponse.configs;
    $('configName').value = '';
    render();
    renderSaved();
  } catch (error) {
    status('Could not load source setup: ' + error.message, true);
  }
}
load();
