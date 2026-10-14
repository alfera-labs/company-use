const line_break_re = /\r?\n/u;
const url_encoded_space_re = /\+/gu;
const connection_setup_open_line_re = /^open (this|these)\b.*\bconnect\b/iu;
const connection_setup_use_link_re = /^use (this|these)\b.*\b(setup|connect)\b.*\blink/iu;
const connection_setup_specific_only_re = /^if you (want|meant)\b.*\b(specific|only)\b/iu;

/** The answer text without the lines that only repeat a connection link the chat already shows as a card. */
export function assistant_text_for_display(text: string, connection_setup_urls: string[]) {
  if (connection_setup_urls.length === 0) return text;

  const lines = text.split(line_break_re);
  const targets = connection_setup_urls.map(connection_setup_text_target);
  const removable_lines = lines.map((line) => connection_setup_line_removal(line.trim(), targets));

  if (!removable_lines.some((reason) => reason === 'connection_url')) return text;

  return trim_blank_lines(lines.filter((_, index) => removable_lines[index] === null)).join('\n');
}

function connection_setup_line_removal(
  line: string,
  connection_setup_targets: ConnectionSetupTextTarget[],
): 'connection_url' | 'boilerplate' | null {
  if (!line) return null;
  if (
    connection_setup_targets.some((target) => connection_setup_line_matches_target(line, target))
  ) {
    return 'connection_url';
  }
  if (is_connection_setup_boilerplate_line(line)) return 'boilerplate';
  return null;
}

type ConnectionSetupTextTarget = {
  app_name?: string;
  url: string;
};

function connection_setup_text_target(url: string): ConnectionSetupTextTarget {
  const parsed_url = parse_url(url);
  const app_name = parsed_url?.searchParams.get('app_name')?.trim();

  return {
    ...(app_name ? { app_name } : {}),
    url: url.trim(),
  };
}

function connection_setup_line_matches_target(line: string, target: ConnectionSetupTextTarget) {
  if (line.includes(target.url)) return true;
  if (!line.includes('/connect/start')) return false;
  if (!target.app_name) return false;

  const normalized_line = normalize_connection_setup_line(line);
  return normalized_line.includes(`app_name=${target.app_name.toLowerCase()}`);
}

function normalize_connection_setup_line(line: string) {
  try {
    return decodeURIComponent(line).replace(url_encoded_space_re, ' ').toLowerCase();
  } catch {
    return line.replace(url_encoded_space_re, ' ').toLowerCase();
  }
}

function parse_url(url: string) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function is_connection_setup_boilerplate_line(line: string) {
  return (
    connection_setup_open_line_re.test(line) ||
    connection_setup_use_link_re.test(line) ||
    connection_setup_specific_only_re.test(line)
  );
}

function trim_blank_lines(lines: string[]) {
  let start = 0;
  let end = lines.length;

  while (start < end && !lines[start]?.trim()) start += 1;
  while (end > start && !lines[end - 1]?.trim()) end -= 1;

  return lines.slice(start, end);
}
