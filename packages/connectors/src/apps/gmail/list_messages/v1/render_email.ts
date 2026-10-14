import { format_byte_size } from '@connectors/format_byte_size';

export type EmailHeaders = {
  from?: string;
  to?: string;
  cc?: string;
  subject?: string;
  date?: string;
};

export type EmailAttachment = {
  name: string;
  mime_type: string;
  byte_size: number | null;
};

const invisible_characters = /[\u00AD\u180E\u200B-\u200F\u2060\uFEFF]/gu;

const quote_line = /^\s*>/u;
const quote_banner = /^\s*(?:-{2,}\s*(?:original message|forwarded message)|_{5,}\s*$)/iu;
const wrote_line = /^\s*on\b[\s\S]*\bwrote:\s*$/iu;

const omitted_thread_line = '[earlier messages in this thread omitted]';

function find_quote_start(lines: string[]): number {
  for (const [index, line] of lines.entries()) {
    if (quote_line.test(line) || quote_banner.test(line)) return index;
    if (!/^\s*on\b/iu.test(line)) continue;
    for (let span = 0; span < 3; span++) {
      if (wrote_line.test(lines.slice(index, index + span + 1).join(' '))) return index;
    }
  }
  return -1;
}

export function clean_email_body(body: string): string {
  const normalised = body
    .replace(/\r\n?/gu, '\n')
    .replace(invisible_characters, '')
    .replace(/[^\S\n]+$/gmu, '');

  const lines = normalised.split('\n');
  const quote_start = find_quote_start(lines);
  const kept = quote_start === -1 ? lines : lines.slice(0, quote_start);
  const text = kept
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();

  if (quote_start === -1) return text;
  if (text.length === 0) return normalised.replace(/\n{3,}/gu, '\n\n').trim();
  return `${text}\n\n${omitted_thread_line}`;
}

export function read_address(value: string | undefined): {
  name: string | null;
  address: string | null;
} {
  if (!value) return { name: null, address: null };
  const angled = /^\s*(.*?)\s*<([^>]+)>\s*$/u.exec(value);
  if (!angled) {
    const bare = value.trim();
    return { name: null, address: bare.length > 0 ? bare : null };
  }
  const name = (angled[1] ?? '').replace(/^"(.*)"$/u, '$1').trim();
  return { name: name.length > 0 ? name : null, address: (angled[2] ?? '').trim() || null };
}

function read_header_offset_minutes(date_header: string): number | null {
  const numeric = /([+-])(\d{2})(\d{2})\s*(?:\([^)]*\))?\s*$/u.exec(date_header);
  if (!numeric) return /\b(?:UTC|GMT|UT|Z)\s*$/u.test(date_header) ? 0 : null;
  const minutes = Number(numeric[2]) * 60 + Number(numeric[3]);
  return numeric[1] === '-' ? -minutes : minutes;
}

export type EmailTime = { iso: string; readable: string } | null;

export function read_email_time(headers: EmailHeaders, internal_date?: string): EmailTime {
  const header_ms = headers.date ? Date.parse(headers.date) : Number.NaN;
  const instant_ms = Number.isNaN(header_ms) ? Number(internal_date) : header_ms;
  if (!Number.isFinite(instant_ms)) return null;

  const offset_minutes = Number.isNaN(header_ms)
    ? 0
    : (read_header_offset_minutes(headers.date ?? '') ?? 0);
  const wall_clock = new Date(instant_ms + offset_minutes * 60_000).toISOString();
  const offset = format_offset(offset_minutes);
  return {
    iso: `${wall_clock.slice(0, 19)}${offset}`,
    readable: `${wall_clock.slice(0, 10)} ${wall_clock.slice(11, 16)} (${offset})`,
  };
}

function format_offset(minutes: number): string {
  if (minutes === 0) return '+00:00';
  const sign = minutes < 0 ? '-' : '+';
  const total = Math.abs(minutes);
  return `${sign}${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export type RenderEmailInput = {
  headers: EmailHeaders;
  time: EmailTime;
  label_names: string[];
  attachments: EmailAttachment[];
  body: string;
};

export function render_email(input: RenderEmailInput): string {
  const header_lines = [
    input.headers.from ? `From: ${input.headers.from}` : null,
    input.headers.to ? `To: ${input.headers.to}` : null,
    input.headers.cc ? `Cc: ${input.headers.cc}` : null,
    input.time ? `Date: ${input.time.readable}` : null,
    input.headers.subject ? `Subject: ${input.headers.subject}` : null,
    input.label_names.length > 0 ? `Labels: ${input.label_names.join(', ')}` : null,
    ...input.attachments.map(render_attachment),
  ].filter((line): line is string => line !== null);

  const body = clean_email_body(input.body);
  return body.length > 0 ? `${header_lines.join('\n')}\n\n${body}` : header_lines.join('\n');
}

function render_attachment(attachment: EmailAttachment): string {
  return `\u{1F4CE} ${attachment.name} (${attachment.mime_type}, ${format_byte_size(attachment.byte_size)})`;
}
