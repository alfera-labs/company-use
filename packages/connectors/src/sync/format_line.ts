const epoch_seconds_pattern = /^\d+(\.\d+)?$/u;

export function to_epoch_ms(value: unknown): number | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  const marker = String(value);
  if (epoch_seconds_pattern.test(marker)) return Number(marker) * 1000;
  const parsed = Date.parse(marker);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function format_utc_clock(time_ms: number): string | undefined {
  const date = new Date(time_ms);
  if (Number.isNaN(date.getTime())) return undefined;
  const hours = date.getUTCHours().toString().padStart(2, '0');
  const minutes = date.getUTCMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function format_line(author: string, time_ms: number | undefined, text: string): string {
  const clock = time_ms === undefined ? undefined : format_utc_clock(time_ms);
  if (clock === undefined) return `[${author}] ${text}`;
  return `[${author} · ${clock}] ${text}`;
}
