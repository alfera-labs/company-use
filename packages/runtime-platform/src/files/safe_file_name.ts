import path from 'node:path';

const maximum_file_name_length = 180;
const maximum_path_segment_length = 120;

export function generate_safe_file_name(name: string | undefined, fallback = 'file') {
  const base_name = path.posix.basename((name ?? '').replaceAll('\\', '/')).trim();
  const without_leading_dots = base_name.replace(/^\.+/u, '');
  const safe = Array.from(without_leading_dots, safe_file_name_character)
    .join('')
    .slice(0, maximum_file_name_length);
  return safe || fallback;
}

export function generate_safe_path_segment(value: string, fallback = 'item') {
  return value.replace(/[^A-Za-z0-9._-]+/gu, '_').slice(0, maximum_path_segment_length) || fallback;
}

function safe_file_name_character(character: string) {
  const code = character.charCodeAt(0);
  if (code < 32 || code === 127) return '_';
  return character === '/' || character === '\\' ? '_' : character;
}
