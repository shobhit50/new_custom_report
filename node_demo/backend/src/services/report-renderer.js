import { compileReport } from './report-engine.js';
import { renderReportTemplate } from '../views/render-report.js';

export function renderHtml(config, datasets, { reportDate = '2026-10-13', baseUrl, heading, footerText = '', images = {}, colours = {} } = {}) {
  if (!baseUrl) throw new Error('baseUrl is required');
  const colour = { top_header: '245A81', text_colour: 'FFFFFF', row_index_colour: 'ECF4FA', ...colours };
  for (const [key, value] of Object.entries(colour)) if (!/^[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/.test(value)) throw new Error(`Invalid CSS color for ${key}`);
  const asset = (name) => `${baseUrl}/assets/${name}`;
  const templateImages = {
    LF_logo: asset('LF_logo_2.svg'), client_logo: '', client_name: '',
    platforms: [['Meta', 'meta'], ['Google Ads', 'google_ads'], ['GA4', 'ga4']].map(([name, file]) => ({ name, logo: asset(`platform/${file}.svg`) })),
    astric_sign: asset('asterisk-svgrepo-com.svg'), weavr_logo: asset('weavr-new.png'), ...images
  };
  return renderReportTemplate({ rendered_report: compileReport(config, datasets, reportDate), heading: heading ?? config.template_name ?? 'Report', template_images: templateImages, colour_code: colour, footer_text: footerText });
}
