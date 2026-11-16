import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const catalog = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../../../shared/source-catalog.json', import.meta.url)), 'utf8'));
const example = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../../../shared/source-config.example.json', import.meta.url)), 'utf8')).sources;
const combinationReference = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../../../../source-first-config.json', import.meta.url)), 'utf8'));

export function sourceConfigCatalog() { return { catalog, example, combinationOptions: combinationReference.combinations }; }

function fail(message) { throw new Error(`Source config: ${message}`); }
function strings(value, name, { min = 1, max = 30 } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max || value.some((item) => typeof item !== 'string' || !item.trim())) fail(`${name} must contain ${min}–${max} names`);
  if (new Set(value).size !== value.length) fail(`${name} has duplicate names`);
}
function id(value, name) {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(value)) fail(`${name} must be a short ID`);
}

export function validateSourceConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('expected an object');
  if (value.contract_version !== 1) fail('contract_version must be 1');
  if (!catalog.breakdowns.includes(value.breakdown)) fail('unsupported breakdown');
  if (!Array.isArray(value.inputs) || !value.inputs.length || value.inputs.length > 12) fail('choose 1–12 inputs');
  const inputs = new Map();
  for (const input of value.inputs) {
    id(input?.id, 'input ID');
    if (inputs.has(input.id)) fail(`duplicate input ${input.id}`);
    const platform = catalog.platforms.find((item) => item.id === input.platform);
    if (!platform) fail(`unknown platform ${input.platform}`);
    if (input.label !== undefined) fail(`${input.id} stream name is derived from its platform and level`);
    const level = platform.levels.find((item) => item.id === input.level);
    if (!level) fail(`${input.platform} does not support ${input.level}`);
    strings(input.account_refs, `${input.id} accounts`, { max: 10 });
    if (input.account_refs.some((ref) => !platform.accounts.some((account) => account.ref === ref))) fail(`${input.id} has an unavailable account`);
    strings(input.dimensions, `${input.id} dimensions`);
    strings(input.metrics, `${input.id} metrics`);
    if (!input.dimensions.includes('date')) fail(`${input.id} must include date`);
    if (input.dimensions.some((item) => !level.dimensions.includes(item))) fail(`${input.id} has an unsupported dimension`);
    if (input.metrics.some((item) => !level.metrics.includes(item))) fail(`${input.id} has an unsupported metric`);
    if (input.filters !== undefined) {
      if (!Array.isArray(input.filters) || input.filters.length > 8) fail(`${input.id} has invalid filters`);
      for (const filter of input.filters) {
        if (!input.dimensions.includes(filter?.dimension) || filter.operator !== 'in') fail(`${input.id} has an unsupported filter`);
        strings(filter.values, `${input.id} filter values`, { max: 20 });
      }
    }
    inputs.set(input.id, input);
  }
  if (value.combinations !== undefined) {
    if (!Array.isArray(value.combinations) || value.combinations.length > 20) fail('combinations must be a list of at most 20');
    const combinationIds = new Set();
    const available = new Map(inputs);
    for (const item of value.combinations) {
      id(item?.id, 'combination ID');
      if (inputs.has(item.id) || combinationIds.has(item.id)) fail(`duplicate combination ${item.id}`);
      combinationIds.add(item.id);
      if (typeof item.label !== 'string' || !item.label.trim() || item.label.length > 80) fail(`${item.id} needs a name`);
      if (!['independent', 'append', 'match', 'align'].includes(item.operation)) fail(`${item.id} has an unsupported operation`);
      strings(item.inputs, `${item.id} inputs`, { min: item.operation === 'independent' ? 1 : 2, max: item.operation === 'independent' ? 1 : item.operation === 'match' ? 2 : 12 });
      if (item.inputs.some((inputId) => !available.has(inputId))) fail(`${item.id} has an unknown or later input`);
      const members = item.inputs.map((inputId) => available.get(inputId));
      const scopes = item.traffic_scope || {};
      if (!scopes || typeof scopes !== 'object' || Array.isArray(scopes)) fail(`${item.id} has invalid GA4 traffic rules`);
      for (const [inputId, scope] of Object.entries(scopes)) {
        const input = available.get(inputId);
        if (!item.inputs.includes(inputId) || input?.platform !== 'ga4' || !input.dimensions.includes('source_medium')) fail(`${item.id} has an invalid GA4 traffic source`);
        if (!scope || !['all', 'values'].includes(scope.mode)) fail(`${item.id} has an invalid GA4 traffic scope`);
        if (scope.mode === 'values') {
          strings(scope.values, `${item.id} GA4 source / medium values`, { max: 100 });
          const filtered = input.filters?.find((filter) => filter.dimension === 'source_medium')?.values;
          if (filtered?.length && scope.values.some((value) => !filtered.some((allowed) => allowed.toLowerCase() === value.toLowerCase()))) fail(`${item.id} selects GA4 traffic excluded by Step 1`);
        }
        else if (!Array.isArray(scope.values) || scope.values.length) fail(`${item.id} all-traffic scope cannot list values`);
      }
      for (const input of members) if (input.platform === 'ga4' && input.dimensions.includes('source_medium') && !scopes[input.id]) fail(`${item.id} needs a GA4 traffic scope for ${input.id}`);
      if (item.operation === 'match') {
        if (!['left', 'inner', 'full'].includes(item.join_type)) fail(`${item.id} has an unsupported record policy`);
        if (!Array.isArray(item.keys) || !item.keys.length || item.keys.length > 8) fail(`${item.id} needs 1–8 match fields`);
        const leftKeys = [], rightKeys = [];
        for (const key of item.keys) {
          if (!members[0].dimensions.includes(key?.left) || !members[1].dimensions.includes(key?.right)) fail(`${item.id} has an unavailable match field`);
          leftKeys.push(key.left); rightKeys.push(key.right);
        }
        strings(leftKeys, `${item.id} first-source match fields`, { max: 8 });
        strings(rightKeys, `${item.id} second-source match fields`, { max: 8 });
      }
      if (item.operation === 'align') {
        strings(item.group_by, `${item.id} alignment fields`, { max: 8 });
        const shared = members.slice(1).reduce((fields, input) => fields.filter((field) => input.dimensions.includes(field)), [...members[0].dimensions]);
        if (item.group_by.some((field) => !shared.includes(field))) fail(`${item.id} has an unavailable alignment field`);
      }
      if (item.operation === 'match' || item.operation === 'align') {
        const suppliers = item.metric_sources;
        if (!suppliers || typeof suppliers !== 'object' || Array.isArray(suppliers)) fail(`${item.id} needs metric suppliers`);
        const availableMetrics = new Set(members.flatMap((input) => input.metrics));
        if (Object.keys(suppliers).length !== availableMetrics.size) fail(`${item.id} must choose a supplier for every metric`);
        for (const metric of availableMetrics) if (!members.find((input) => input.id === suppliers[metric] && input.metrics.includes(metric))) fail(`${item.id}.${metric} has an unavailable metric supplier`);
      }
      const dimensions = item.operation === 'align' ? item.group_by : item.operation === 'match' ? item.keys.map((key) => key.left) : item.operation === 'append' ? ['source', ...members.slice(1).reduce((fields, input) => fields.filter((field) => input.dimensions.includes(field)), [...members[0].dimensions])] : [...members[0].dimensions];
      const metrics = [...new Set(members.flatMap((input) => input.metrics))];
      available.set(item.id, { id: item.id, platform: 'combination', dimensions, metrics });
    }
    return value;
  }
  if (!Array.isArray(value.merges) || value.merges.length > 12) fail('merges must be a list of at most 12');
  const merges = new Map();
  for (const merge of value.merges) {
    id(merge?.id, 'merge ID');
    if (inputs.has(merge.id) || merges.has(merge.id)) fail(`duplicate merge ${merge.id}`);
    const left = inputs.get(merge.left), right = inputs.get(merge.right);
    if (!left || !right || left === right) fail(`${merge.id} must use two different inputs`);
    if (merge.mode !== 'join' || !['left', 'inner'].includes(merge.join_type) || merge.cardinality !== 'one_to_one') fail(`${merge.id} has unsupported merge options`);
    if (!['keep_null', 'drop'].includes(merge.unmatched)) fail(`${merge.id} has unsupported unmatched handling`);
    if (!Array.isArray(merge.keys) || !merge.keys.length || merge.keys.length > 8) fail(`${merge.id} needs 1–8 match keys`);
    const leftKeys = [], rightKeys = [];
    for (const key of merge.keys) {
      if (!left.dimensions.includes(key?.left) || !right.dimensions.includes(key?.right)) fail(`${merge.id} has an unsupported match key`);
      leftKeys.push(key.left); rightKeys.push(key.right);
    }
    strings(leftKeys, `${merge.id} left keys`, { max: 8 });
    strings(rightKeys, `${merge.id} right keys`, { max: 8 });
    if (JSON.stringify(merge.prepare?.left_group_by) !== JSON.stringify(leftKeys) || JSON.stringify(merge.prepare?.right_group_by) !== JSON.stringify(rightKeys)) fail(`${merge.id} must aggregate on its match keys before joining`);
    const conflicts = left.metrics.filter((metric) => right.metrics.includes(metric));
    const chosen = merge.metric_sources || {};
    if (Object.keys(chosen).length !== conflicts.length || conflicts.some((metric) => ![merge.left, merge.right].includes(chosen[metric]))) fail(`${merge.id} must choose one source for each shared metric`);
    merges.set(merge.id, merge);
  }
  const mode = value.composition?.mode || (value.merges.length ? 'match' : 'separate');
  if (!['separate', 'match', 'channels'].includes(mode)) fail('unsupported composition mode');
  if (mode === 'match' && !value.merges.length) fail('match mode needs a source match');
  if (mode !== 'match' && value.merges.length) fail(`${mode} mode cannot contain source matches`);
  if (mode === 'channels') {
    const channels = value.composition?.channels;
    if (!Array.isArray(channels) || !channels.length || channels.length > 12) fail('channel mode needs 1–12 channels');
    const channelIds = new Set();
    const channelLabels = new Set();
    const assigned = new Set();
    for (const channel of channels) {
      id(channel?.id, 'channel ID');
      if (channelIds.has(channel.id)) fail(`duplicate channel ${channel.id}`);
      channelIds.add(channel.id);
      if (typeof channel.label !== 'string' || !channel.label.trim()) fail(`${channel.id} needs a label`);
      const labelKey = channel.label.trim().toLowerCase();
      if (channelLabels.has(labelKey)) fail(`duplicate channel label ${channel.label}`);
      channelLabels.add(labelKey);
      strings(channel.inputs, `${channel.id} inputs`, { max: 12 });
      for (const inputId of channel.inputs) {
        if (!inputs.has(inputId)) fail(`${channel.id} has an unknown input`);
        if (assigned.has(inputId)) fail(`${inputId} is assigned to more than one channel`);
        assigned.add(inputId);
      }
      const paid = channel.inputs.some((inputId) => ['google_ads', 'meta_ads'].includes(inputs.get(inputId).platform));
      if (paid && channel.inputs.some((inputId) => inputs.get(inputId).platform === 'ga4' && !(inputs.get(inputId).filters || []).some((filter) => filter.dimension === 'source_medium'))) fail(`${channel.id} needs filtered GA4 traffic alongside paid media`);
      const suppliers = channel.metric_sources;
      if (!suppliers || typeof suppliers !== 'object' || Array.isArray(suppliers) || !Object.keys(suppliers).length) fail(`${channel.id} needs metric suppliers`);
      for (const [metric, supplier] of Object.entries(suppliers)) {
        if (!/^[a-z][a-z0-9_]{0,63}$/.test(metric)) fail(`${channel.id} has an invalid output metric`);
        if (!channel.inputs.includes(supplier?.input) || supplier.metric !== metric || !inputs.get(supplier.input)?.metrics.includes(supplier.metric)) fail(`${channel.id}.${metric} has an unavailable metric supplier`);
      }
    }
    if (assigned.size !== inputs.size) fail('every input must belong to one channel');
  } else if (value.composition?.channels?.length) fail('channel mappings require channels mode');
  if (!value.grouping || typeof value.grouping !== 'object') fail('grouping is required');
  strings(value.grouping.group_by, 'group_by', { max: 8 });
  const sharedDimensions = value.inputs.slice(1).reduce((shared, input) => shared.filter((field) => input.dimensions.includes(field)), [...value.inputs[0].dimensions]);
  const available = new Set([mode === 'channels' ? 'channel' : 'source', ...sharedDimensions]);
  if (value.grouping.group_by.some((field) => !available.has(field))) fail('group_by contains an unavailable dimension');
  if (mode === 'channels' && !value.grouping.group_by.includes('channel')) fail('channel mode must retain channel identity');
  if (mode !== 'channels' && value.inputs.length > 1 && !value.grouping.group_by.includes('source')) fail('multiple sources must retain source identity');
  return value;
}
