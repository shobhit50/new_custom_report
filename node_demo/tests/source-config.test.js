import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceConfigCatalog, validateSourceConfig } from '../backend/src/models/source-config.model.js';

const { example, catalog, combinationOptions } = sourceConfigCatalog();
const clone = () => structuredClone(example);

test('combination options cover every platform subset and retain campaign grouping guidance', () => {
  assert.equal(combinationOptions.length, 15);
  assert.equal(new Set(combinationOptions.map((item) => [...item.platforms].sort().join('+'))).size, 15);
  assert.ok(combinationOptions.every((item) => item.possible_groupings.length > 0));
  const campaign = combinationOptions.find((item) => item.id === 'google_ga4').possible_groupings.find((grouping) => grouping.by.join('+') === 'date+google_customer_id+google_campaign_id');
  assert.equal(campaign.availability, 'conditional');
  assert.equal(campaign.field_map.google.google_campaign_id, 'campaign_id');
});

test('sample source plan covers four platforms, five streams and two explicit merges', () => {
  assert.equal(catalog.platforms.length, 4);
  assert.equal(new Set(example.inputs.map((input) => input.platform)).size, 4);
  assert.equal(example.inputs.length, 5);
  assert.equal(example.merges.length, 2);
  assert.deepEqual(validateSourceConfig(clone()).grouping.group_by, ['date', 'source']);
});

test('source plan rejects unsupported fields and ambiguous matches', () => {
  const unsupported = clone();
  unsupported.inputs[0].metrics.push('invented_metric');
  assert.throws(() => validateSourceConfig(unsupported), /unsupported metric/);

  const customLabel = clone();
  customLabel.inputs[0].label = 'Custom stream name';
  assert.throws(() => validateSourceConfig(customLabel), /stream name is derived/);

  const duplicateKey = clone();
  duplicateKey.merges[0].keys.push({ left: 'date', right: 'date' });
  duplicateKey.merges[0].prepare.left_group_by.push('date');
  duplicateKey.merges[0].prepare.right_group_by.push('date');
  assert.throws(() => validateSourceConfig(duplicateKey), /duplicate names/);

  const unsupportedGroup = clone();
  unsupportedGroup.grouping.group_by.push('campaign_id');
  assert.throws(() => validateSourceConfig(unsupportedGroup), /unavailable dimension/);

  const conflictingMetrics = clone();
  conflictingMetrics.merges[0].right = 'meta';
  conflictingMetrics.merges[0].keys = [{ left: 'date', right: 'date' }];
  conflictingMetrics.merges[0].prepare = { left_group_by: ['date'], right_group_by: ['date'] };
  assert.throws(() => validateSourceConfig(conflictingMetrics), /choose one source/);
});

test('channel blend assigns every stream once and records metric ownership', () => {
  const plan = clone();
  plan.merges = [];
  plan.composition = {
    mode: 'channels',
    channels: [
      { id: 'google', label: 'Google', inputs: ['google', 'ga4_google'], metric_sources: { spend: { input: 'google', metric: 'spend' }, revenue: { input: 'ga4_google', metric: 'revenue' }, sessions: { input: 'ga4_google', metric: 'sessions' } } },
      { id: 'meta', label: 'Meta', inputs: ['meta', 'ga4_meta'], metric_sources: { spend: { input: 'meta', metric: 'spend' }, revenue: { input: 'ga4_meta', metric: 'revenue' } } },
      { id: 'shopify', label: 'Shopify', inputs: ['shopify'], metric_sources: { revenue: { input: 'shopify', metric: 'revenue' } } }
    ]
  };
  plan.grouping.group_by = ['date', 'channel'];
  assert.equal(validateSourceConfig(plan).composition.channels.length, 3);

  const duplicate = structuredClone(plan);
  duplicate.composition.channels[1].inputs.push('google');
  assert.throws(() => validateSourceConfig(duplicate), /more than one channel/);

  const unfiltered = structuredClone(plan);
  delete unfiltered.inputs.find((input) => input.id === 'ga4_google').filters;
  assert.throws(() => validateSourceConfig(unfiltered), /filtered GA4 traffic/);

  const wrongSupplier = structuredClone(plan);
  wrongSupplier.composition.channels[0].metric_sources.revenue.input = 'google';
  assert.throws(() => validateSourceConfig(wrongSupplier), /unavailable metric supplier/);
});

test('independent combinations support append, campaign match, and channel alignment together', () => {
  const plan = clone();
  delete plan.merges;
  delete plan.composition;
  delete plan.grouping;
  plan.combinations = [
    { id: 'paid_rows', label: 'Paid campaigns', operation: 'append', inputs: ['google', 'meta'], traffic_scope: {} },
    { id: 'google_ga4', label: 'Google campaign metrics', operation: 'match', inputs: ['google', 'ga4_google'], keys: [
      { left: 'date', right: 'date' },
      { left: 'account_id', right: 'google_ads_customer_id' },
      { left: 'campaign_id', right: 'google_ads_campaign_id' }
    ], join_type: 'left', traffic_scope: { ga4_google: { mode: 'values', values: ['google / cpc', 'google/cpc'] } }, metric_sources: { spend: 'google', clicks: 'google', impressions: 'google', revenue: 'ga4_google', sessions: 'ga4_google' } },
    { id: 'meta_ga4', label: 'Meta channel metrics', operation: 'align', inputs: ['meta', 'ga4_meta'], group_by: ['date'], traffic_scope: { ga4_meta: { mode: 'values', values: ['Meta / MetaAds'] } }, metric_sources: { spend: 'meta', clicks: 'meta', impressions: 'meta', revenue: 'ga4_meta', sessions: 'ga4_meta' } }
  ];
  assert.equal(validateSourceConfig(plan).combinations.length, 3);

  const outsideFilter = structuredClone(plan);
  outsideFilter.combinations[2].traffic_scope.ga4_meta.values = ['google / cpc'];
  assert.throws(() => validateSourceConfig(outsideFilter), /excluded by Step 1/);

  const missingSupplier = structuredClone(plan);
  delete missingSupplier.combinations[2].metric_sources.revenue;
  assert.throws(() => validateSourceConfig(missingSupplier), /supplier for every metric/);

  const invalidMatch = structuredClone(plan);
  invalidMatch.combinations[1].keys[2].right = 'not_a_field';
  assert.throws(() => validateSourceConfig(invalidMatch), /unavailable match field/);
});

test('a later combination can use an earlier combined result', () => {
  const plan = clone();
  delete plan.merges;
  delete plan.composition;
  delete plan.grouping;
  plan.inputs.find((input) => input.id === 'ga4_google').filters[0].values.push('Meta / MetaAds');
  plan.combinations = [
    { id: 'paid_rows', label: 'Paid rows', operation: 'append', inputs: ['google', 'meta'], traffic_scope: {} },
    { id: 'paid_total', label: 'Paid metrics', operation: 'align', inputs: ['paid_rows', 'ga4_google'], group_by: ['date'], traffic_scope: { ga4_google: { mode: 'values', values: ['google / cpc', 'google/cpc', 'Meta / MetaAds'] } }, metric_sources: { spend: 'paid_rows', clicks: 'paid_rows', impressions: 'paid_rows', sessions: 'ga4_google', revenue: 'ga4_google' } }
  ];
  assert.equal(validateSourceConfig(plan).combinations[1].inputs[0], 'paid_rows');
  const reversed = structuredClone(plan);
  reversed.combinations.reverse();
  assert.throws(() => validateSourceConfig(reversed), /unknown or later input/);
});
