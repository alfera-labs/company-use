export function parse_retry_after(
  header: string | null | undefined,
  now_ms = Date.now(),
): number | null {
  if (!header) return null;
  const seconds = Number(header.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const retry_time_ms = Date.parse(header);
  return Number.isNaN(retry_time_ms) ? null : Math.max(0, retry_time_ms - now_ms);
}
