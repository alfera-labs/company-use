export type ByteRangeRequest =
  | { range_kind: 'whole' }
  | { range_kind: 'partial'; start: number; end: number }
  | { range_kind: 'unsatisfiable' };

const single_range_pattern = /^bytes=(\d*)-(\d*)$/u;

function read_suffix_range(suffix_text: string, total: number): ByteRangeRequest {
  const suffix_length = Number(suffix_text);
  if (suffix_length === 0 || total === 0) return { range_kind: 'unsatisfiable' };
  return { range_kind: 'partial', start: Math.max(0, total - suffix_length), end: total - 1 };
}

export function read_byte_range(header: string | undefined, total: number): ByteRangeRequest {
  const match = header?.trim().match(single_range_pattern);
  if (!match) return { range_kind: 'whole' };
  const [, start_text = '', end_text = ''] = match;
  if (start_text === '' && end_text === '') return { range_kind: 'whole' };
  if (start_text === '') return read_suffix_range(end_text, total);
  const start = Number(start_text);
  const end = end_text === '' ? total - 1 : Math.min(Number(end_text), total - 1);
  if (start >= total || end < start) return { range_kind: 'unsatisfiable' };
  return { range_kind: 'partial', start, end };
}
