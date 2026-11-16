"""Focused checks for source identity, grain, and Meta connector mapping."""
import copy
import json
import tempfile
import unittest
from pathlib import Path

from build_dataset import build_dataset, normalize_meta_campaign_daily

ROOT = Path(__file__).resolve().parent


class DatasetBuilderTests(unittest.TestCase):
    def test_local_registry_has_dataset_ids_and_no_view_scope(self):
        registry = build_dataset(ROOT / 'Data_Source')
        self.assertEqual(set(registry), {'perf_meta', 'b2b_meta', 'perf_google',
                                         'perf_ga4', 'perf_shopify'})
        self.assertNotIn('report_scope', registry['perf_meta']['columns'])

    def test_duplicate_source_grain_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            for source in (ROOT / 'Data_Source').glob('*.json'):
                (path / source.name).write_bytes(source.read_bytes())
            meta = path / 'meta_ads.json'
            payload = json.loads(meta.read_text())
            payload['rows'].append(copy.deepcopy(payload['rows'][0]))
            meta.write_text(json.dumps(payload))
            with self.assertRaisesRegex(ValueError, 'duplicate source grain'):
                build_dataset(path)

    def test_meta_campaign_daily_mapping_and_identity(self):
        raw = {'date_start': '2026-10-12', 'campaign_id': 123,
               'campaign_name': 'Launch', 'spend': '0', 'impressions': '10',
               'inline_link_clicks': '2'}
        dataset = normalize_meta_campaign_daily([raw], account_id='act_1')
        self.assertEqual(dataset['grain'], ['date', 'account_id', 'campaign_id'])
        self.assertEqual(dataset['rows'][0]['campaign_id'], '123')
        self.assertEqual(dataset['rows'][0]['spend'], 0)
        self.assertEqual(dataset['rows'][0]['link_clicks'], 2)
        with self.assertRaisesRegex(ValueError, 'duplicate campaign/day/account grain'):
            normalize_meta_campaign_daily([raw, raw], account_id='act_1')
        bad = {**raw, 'spend': 'NaN'}
        with self.assertRaisesRegex(ValueError, 'nonfinite spend'):
            normalize_meta_campaign_daily([bad], account_id='act_1')


if __name__ == '__main__':
    unittest.main()
