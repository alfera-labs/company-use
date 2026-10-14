const byte_units = ['B', 'KB', 'MB', 'GB'] as const;

export function format_byte_size(size: number | null | undefined): string {
  if (size === null || size === undefined) return 'unknown size';
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < byte_units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${byte_units[unit]}`;
}
