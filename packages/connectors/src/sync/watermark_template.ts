import { to_time_ms } from '@connectors/sync/sync_markers';
import type { WatermarkTemplate, WatermarkTemplateEscape } from '@connectors/sync_types';

const watermark_placeholder = '{watermark}';

function quote_for_sql(watermark: string): string {
  return watermark.replaceAll("'", "''");
}

function quote_with_backslash(watermark: string): string {
  return watermark.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}

function format_time_literal(watermark: string): string {
  const time_ms = to_time_ms(watermark);
  if (time_ms === null) {
    throw new Error(`The watermark ${watermark} is not a time, so it cannot fill a time literal.`);
  }
  return new Date(time_ms).toISOString();
}

const watermark_escapes: Readonly<Record<WatermarkTemplateEscape, (watermark: string) => string>> =
  {
    sql_quote: quote_for_sql,
    backslash_quote: quote_with_backslash,
    time_literal: format_time_literal,
  };

export function fill_watermark_template(template: WatermarkTemplate, watermark: string): string {
  const escaped = watermark_escapes[template.escape](watermark);
  return template.text.replaceAll(watermark_placeholder, escaped);
}
