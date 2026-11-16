"""Build Data_Set from Data_Source, then render every config to PNG."""
from __future__ import annotations

import argparse
import importlib.util
import json
import re
import shutil
import subprocess
import tempfile
from copy import deepcopy
from datetime import date
from pathlib import Path
import sys

from jinja2 import Environment, FileSystemLoader, StrictUndefined, select_autoescape
from build_dataset import build_dataset, write_dataset

ROOT = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location('reference_engine', ROOT / 'reference_engine.py')
_module = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = _module
_spec.loader.exec_module(_module)
Engine, format_value = _module.Engine, _module.format_value


def compile_report(config: dict, datasets: dict, *, report_date: str) -> dict:
    result = deepcopy(Engine(datasets, today=report_date).render(config))
    for block in result['blocks']:
        for table in block['tables']:
            for row in table['rows']:
                for cell in row['cells']:
                    cell['display'] = format_value(cell['value'], cell['format'])
    return result


def default_images() -> dict:
    def uri(name: str) -> str:
        return (ROOT / 'assets' / name).resolve().as_uri()
    return {
        'LF_logo': uri('LF_logo_2.svg'), 'client_logo': '', 'client_name': '',
        'platforms': [{'name': name, 'logo': uri(f'platform/{filename}.svg')}
                      for name, filename in [('Meta', 'meta'), ('Google Ads', 'google_ads'), ('GA4', 'ga4')]],
        'astric_sign': uri('asterisk-svgrepo-com.svg'),
        'weavr_logo': uri('weavr-new.png'),
    }


def render_html(config: dict, datasets: dict, *, report_date: str,
                heading: str = '', template_images: dict | None = None,
                colour_code: dict | None = None, footer_text: str = '') -> str:
    images = default_images()
    images.update(template_images or {})
    palette = {'top_header': '245A81', 'text_colour': 'FFFFFF', 'row_index_colour': 'ECF4FA'}
    palette.update(colour_code or {})
    for key, value in palette.items():
        if not isinstance(value, str) or not re.fullmatch(r'[0-9a-fA-F]{3}([0-9a-fA-F]{3})?', value):
            raise ValueError(f'Invalid CSS color for {key}')
    env = Environment(loader=FileSystemLoader(str(ROOT)), autoescape=select_autoescape(['html']),
                      undefined=StrictUndefined)
    return env.get_template('report_template.html').render(
        rendered_report=compile_report(config, datasets, report_date=report_date),
        heading=heading, template_images=images, colour_code=palette, footer_text=footer_text)


def read_json(path: Path) -> dict:
    if not path.is_file():
        raise ValueError(f'Missing JSON file: {path}')
    if not path.stat().st_size:
        raise ValueError(f'Empty JSON file: {path}. Add normalized data or use --demo.')
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except json.JSONDecodeError as exc:
        raise ValueError(f'Invalid JSON in {path}: {exc}') from exc


def load_datasets(data_dir: Path) -> dict:
    """Compatibility helper for callers needing the in-memory dataset."""
    return build_dataset(data_dir)


def render_png(html_content: str, png_path: Path, *, width: int = 1600) -> None:
    """Render template markup to PNG without saving a report HTML file."""
    if shutil.which('wkhtmltoimage'):
        import imgkit
        imgkit.from_string(html_content, str(png_path), options={
            'format': 'png', 'quality': 100, 'encoding': 'UTF-8',
            'enable-local-file-access': None, 'width': width})
        return
    chrome = Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    if not chrome.is_file():
        raise RuntimeError('Install wkhtmltoimage + imgkit or Google Chrome for PNG output')
    with tempfile.TemporaryDirectory() as profile:
        temporary_html = Path(profile) / 'report.html'
        temporary_html.write_text(html_content, encoding='utf-8')
        command = [str(chrome), '--headless', '--disable-gpu', '--no-first-run',
                   f'--user-data-dir={profile}', '--allow-file-access-from-files',
                   '--hide-scrollbars', f'--window-size={width},3000',
                   f'--screenshot={png_path.resolve()}', temporary_html.as_uri()]
        completed = subprocess.run(command, capture_output=True, text=True, timeout=60)
    if completed.returncode or not png_path.is_file():
        raise RuntimeError(f'Chrome PNG render failed: {completed.stderr[-1000:]}')
    try:
        from PIL import Image, ImageChops
        with Image.open(png_path) as original:
            image = original.convert('RGB')
            box = ImageChops.difference(image, Image.new('RGB', image.size, 'white')).getbbox()
            if box:
                image.crop((0, 0, image.width, min(image.height, box[3] + 20))).save(png_path)
    except ImportError:
        pass


def render_one(config: dict, datasets: dict, *, report_date: str,
               png_path: Path) -> None:
    content = render_html(config, datasets, report_date=report_date,
                          heading=config.get('template_name', 'Report'))
    png_path.parent.mkdir(parents=True, exist_ok=True)
    render_png(content, png_path)
    print(f'PNG: {png_path}')


def write_combined_png(output_dir: Path, png_paths: list[Path]) -> None:
    if not png_paths:
        return
    from PIL import Image
    images = []
    try:
        for png in png_paths:
            with Image.open(png) as source:
                images.append(source.convert('RGB'))
        width = max(image.width for image in images)
        height = sum(image.height for image in images) + 20 * (len(images) - 1)
        combined = Image.new('RGB', (width, height), 'white')
        offset = 0
        for image in images:
            combined.paste(image, (0, offset))
            offset += image.height + 20
        combined.save(output_dir / 'report.png')
        print(f'All reports PNG: {output_dir / "report.png"}')
    finally:
        for image in images:
            image.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, help='Render only this config; default renders all configs')
    parser.add_argument('--data-dir', type=Path, default=ROOT / 'Data_Source')
    parser.add_argument('--dataset-output', type=Path, default=ROOT / 'Data_Set/datasets.json')
    parser.add_argument('--report-date', default=date.today().isoformat())
    parser.add_argument('--png', type=Path, help='Single-report PNG output path')
    parser.add_argument('--demo', action='store_true', help='Use bundled synthetic fixture')
    args = parser.parse_args()
    if args.demo and args.config:
        parser.error('--demo and --config cannot be used together')
    if not (args.demo or args.config) and args.png:
        parser.error('--png requires --config or --demo; batch outputs are named after configs')
    if args.demo:
        fixture = read_json(ROOT / 'fixtures/fixtures_30.json')
        config, datasets = fixture['reports'][0], fixture['datasets']
        args.dataset_output.parent.mkdir(parents=True, exist_ok=True)
        args.dataset_output.write_text(json.dumps(datasets, indent=2) + '\n', encoding='utf-8')
        if args.report_date == date.today().isoformat():
            args.report_date = '2026-10-13'
    else:
        write_dataset(args.data_dir, args.dataset_output)
        datasets = read_json(args.dataset_output)
    print(f'Data_Set: {args.dataset_output}')
    if args.demo or args.config:
        if args.config:
            config = read_json(args.config)
        name = 'demo' if args.demo else args.config.stem
        png_path = args.png or ROOT / 'output' / f'{name}.png'
        render_one(config, datasets, report_date=args.report_date,
                   png_path=png_path)
        return

    config_paths = sorted((ROOT / 'template_config').glob('*.json'))
    if not config_paths:
        raise SystemExit('No config JSON files found in template_config')
    output_dir = ROOT / 'output'
    output_dir.mkdir(parents=True, exist_ok=True)
    successes, failures = [], []
    for config_path in config_paths:
        png_path = output_dir / f'{config_path.stem}.png'
        try:
            config = read_json(config_path)
            render_one(config, datasets, report_date=args.report_date,
                       png_path=png_path)
            successes.append(png_path)
        except Exception as exc:
            png_path.unlink(missing_ok=True)
            failures.append((config_path.stem, str(exc)))
            print(f'FAILED {config_path.name}: {exc}', file=sys.stderr)
    write_combined_png(output_dir, successes)
    if failures:
        raise SystemExit(f'{len(failures)} of {len(config_paths)} reports failed')


if __name__ == '__main__':
    main()
