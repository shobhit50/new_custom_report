"""Compile checked-in source rows into V5 report-ready datasets.

This local adapter does not fetch APIs or define a generic dataset DSL.
"""
from __future__ import annotations

import argparse
import json
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SOURCE_SCHEMAS = {
    'google_ads': (['segment', 'date', 'spend'], ['segment', 'date'], ['spend']),
    'meta_ads': (['segment', 'date', 'report_scope', 'spend', 'leads'],
                 ['segment', 'date', 'report_scope'], ['spend', 'leads']),
    'ga4': (['segment', 'date', 'revenue'], ['segment', 'date'], ['revenue']),
    'shopify': (['segment', 'date', 'revenue'], ['segment', 'date'], ['revenue']),
}


def normalize_meta_campaign_daily(raw_rows: list[dict], *, account_id: str) -> dict:
    """Normalize an already fetched Meta campaign/day response.

    The caller must resolve and authorize account_id. This function never fetches
    data or accepts credentials. Field names match the inspected Meta connector.
    """
    if not isinstance(account_id, str) or not account_id.strip():
        raise ValueError('A trusted nonempty account_id is required')
    if not isinstance(raw_rows, list):
        raise ValueError('Meta campaign daily response must be a rows array')
    columns = ['date', 'account_id', 'campaign_id', 'campaign_name',
               'spend', 'impressions', 'link_clicks']
    grain = ['date', 'account_id', 'campaign_id']
    rows, identities = [], set()
    for number, raw in enumerate(raw_rows, 1):
        required = {'date_start', 'campaign_id', 'campaign_name', 'spend',
                    'impressions', 'inline_link_clicks'}
        if not isinstance(raw, dict) or not required <= set(raw):
            raise ValueError(f'Meta row {number}: missing required connector fields')
        try:
            parsed = date.fromisoformat(raw['date_start'])
        except (TypeError, ValueError) as exc:
            raise ValueError(f'Meta row {number}: invalid date_start') from exc
        if parsed.isoformat() != raw['date_start']:
            raise ValueError(f'Meta row {number}: date_start must be YYYY-MM-DD')
        campaign_id = str(raw['campaign_id']).strip() if raw['campaign_id'] is not None else ''
        if not campaign_id:
            raise ValueError(f'Meta row {number}: missing campaign_id')
        identity = (raw['date_start'], account_id, campaign_id)
        if identity in identities:
            raise ValueError(f'Meta row {number}: duplicate campaign/day/account grain')
        identities.add(identity)
        rows.append({
            'date': raw['date_start'], 'account_id': account_id,
            'campaign_id': campaign_id, 'campaign_name': str(raw['campaign_name']),
            'spend': _number(raw['spend'], Path('meta_connector'), number, 'spend'),
            'impressions': _number(raw['impressions'], Path('meta_connector'), number, 'impressions'),
            'link_clicks': _number(raw['inline_link_clicks'], Path('meta_connector'), number, 'inline_link_clicks'),
        })
    return {'columns': columns, 'grain': grain, 'rows': rows}


def _number(value: object, path: Path, row_number: int, field: str) -> int | float | None:
    if value is None:
        return None
    if isinstance(value, bool):
        raise ValueError(f'{path} row {row_number}: {field} cannot be boolean')
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError(f'{path} row {row_number}: invalid {field}') from exc
    if not number.is_finite():
        raise ValueError(f'{path} row {row_number}: nonfinite {field}')
    return int(number) if number == number.to_integral_value() else float(number)


def _load_source(path: Path, platform: str) -> dict:
    columns, grain, numeric = SOURCE_SCHEMAS[platform]
    try:
        source = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f'Cannot read {path}: {exc}') from exc
    if not isinstance(source, dict) or source.get('platform') != platform or not isinstance(source.get('rows'), list):
        raise ValueError(f'{path} must contain platform={platform!r} and a rows array')
    rows, identities = [], set()
    for number, raw in enumerate(source['rows'], 1):
        if not isinstance(raw, dict) or not set(columns) <= set(raw):
            raise ValueError(f'{path} row {number}: required fields are {columns}')
        row = {field: raw[field] for field in columns}
        if any(row[field] is None or row[field] == '' for field in grain):
            raise ValueError(f'{path} row {number}: empty grain value')
        try:
            parsed = date.fromisoformat(row['date'])
        except (TypeError, ValueError) as exc:
            raise ValueError(f'{path} row {number}: invalid ISO date') from exc
        if parsed.isoformat() != row['date']:
            raise ValueError(f'{path} row {number}: date must be YYYY-MM-DD')
        identity = tuple(row[field] for field in grain)
        if identity in identities:
            raise ValueError(f'{path} row {number}: duplicate source grain {identity}')
        identities.add(identity)
        for field in numeric:
            row[field] = _number(row[field], path, number, field)
        rows.append(row)
    return {'columns': columns, 'grain': grain, 'rows': rows}


def _dataset(source: dict, columns: list[str], grain: list[str], *, scope: str | None = None) -> dict:
    rows, identities = [], set()
    for source_row in source['rows']:
        if scope is not None and source_row['report_scope'] != scope:
            continue
        row = {field: source_row[field] for field in columns}
        identity = tuple(row[field] for field in grain)
        if identity in identities:
            raise ValueError(f'Derived dataset has duplicate grain {identity}; no implicit aggregation')
        identities.add(identity)
        rows.append(row)
    return {'columns': columns, 'grain': grain, 'rows': rows}


def build_dataset(data_dir: Path) -> dict:
    """Use stable dataset IDs, separate from platform/source identities."""
    actual = {p.stem for p in data_dir.glob('*.json')}
    expected = set(SOURCE_SCHEMAS)
    if actual != expected:
        raise ValueError(f'Data_Source files mismatch; missing={sorted(expected-actual)}, extra={sorted(actual-expected)}')
    sources = {name: _load_source(data_dir / f'{name}.json', name) for name in SOURCE_SCHEMAS}
    meta = sources['meta_ads']
    return {
        'perf_meta': _dataset(meta, ['segment', 'date', 'spend'], ['segment', 'date'], scope='performance'),
        'b2b_meta': _dataset(meta, ['segment', 'date', 'spend', 'leads'], ['segment', 'date'], scope='b2b'),
        'perf_google': _dataset(sources['google_ads'], ['segment', 'date', 'spend'], ['segment', 'date']),
        'perf_ga4': _dataset(sources['ga4'], ['segment', 'date', 'revenue'], ['segment', 'date']),
        'perf_shopify': _dataset(sources['shopify'], ['segment', 'date', 'revenue'], ['segment', 'date']),
    }


def write_dataset(data_dir: Path, output: Path) -> dict:
    datasets = build_dataset(data_dir)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + '.tmp')
    temporary.write_text(json.dumps(datasets, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    temporary.replace(output)
    return datasets


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir', type=Path, default=ROOT / 'Data_Source')
    parser.add_argument('--output', type=Path, default=ROOT / 'Data_Set/datasets.json')
    args = parser.parse_args()
    write_dataset(args.data_dir, args.output)
    print(f'Data_Set: {args.output}')


if __name__ == '__main__':
    main()
