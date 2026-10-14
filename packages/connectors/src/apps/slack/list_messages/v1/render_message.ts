import { format_byte_size } from '@connectors/format_byte_size';

type SlackFile = {
  id?: string;
  name?: string;
  title?: string;
  mimetype?: string;
  size?: number;
  url_private_download?: string;
  url_private?: string;
  permalink?: string;
};

type SlackReaction = { name?: string; count?: number };

type SlackAttachment = {
  is_msg_unfurl?: boolean;
  author_name?: string;
  author_subname?: string;
  from_url?: string;
  original_url?: string;
  channel_name?: string;
  channel_id?: string;
  ts?: string;
  text?: string;
  fallback?: string;
  title?: string;
  title_link?: string;
  message_blocks?: unknown[];
};

export type SlackRawMessage = {
  ts: string;
  user?: string;
  bot_id?: string;
  username?: string;
  bot_profile?: { name?: string };
  text?: string;
  subtype?: string;
  thread_ts?: string;
  reply_count?: number;
  latest_reply?: string;
  edited?: { user?: string; ts?: string };
  hidden?: boolean;
  files?: SlackFile[];
  reactions?: SlackReaction[];
  attachments?: SlackAttachment[];
};

export type RenderedFile = {
  id: string;
  name: string;
  mime_type: string;
  byte_size: number | null;
  download_url: string | null;
};

export type RenderedUnfurl = { url: string; title: string | null };

export type ForwardedMessage = {
  author: string | null;
  channel: string | null;
  time: string | null;
  text: string;
};

const dropped_subtypes = new Set([
  'channel_join',
  'channel_leave',
  'group_join',
  'group_leave',
  'tombstone',
  'ephemeral',
]);

const rate_limit_notice = /not displaying\b.{0,40}\bmessages\b/isu;

const slack_token = /<([^<>]+)>/gu;

const html_entities: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>' };

export type UserNames = Map<string, string>;

export function message_is_dropped(message: SlackRawMessage): boolean {
  if (message.subtype && dropped_subtypes.has(message.subtype)) return true;
  if (message.hidden === true) return true;
  return rate_limit_notice.test(message.text ?? '');
}

export function find_author_name(message: SlackRawMessage, names: UserNames): string | null {
  if (message.user) return names.get(message.user) ?? message.user;
  return message.bot_profile?.name ?? message.username ?? message.bot_id ?? null;
}

export function resolve_slack_markup(text: string, names: UserNames): string {
  const resolved = text.replace(slack_token, (whole, body: string) =>
    resolve_slack_token(whole, body, names),
  );
  return resolved.replace(/&amp;|&lt;|&gt;/gu, (entity) => html_entities[entity] ?? entity);
}

function resolve_slack_token(whole: string, body: string, names: UserNames): string {
  const pipe = body.indexOf('|');
  const target = pipe === -1 ? body : body.slice(0, pipe);
  const label = pipe === -1 ? null : body.slice(pipe + 1);

  if (target.startsWith('@')) {
    const name = names.get(target.slice(1));
    if (name) return `@${name}`;
    return label ? `@${label}` : whole;
  }
  if (target.startsWith('#')) return label ? `#${label}` : whole;
  if (target.startsWith('!')) return label ?? `@${target.slice(1)}`;
  return label ? `${label} (${target})` : target;
}

const clock_formats = new Map<string, Intl.DateTimeFormat>();
const parts_formats = new Map<string, Intl.DateTimeFormat>();
const offset_formats = new Map<string, Intl.DateTimeFormat>();

function read_format(
  cache: Map<string, Intl.DateTimeFormat>,
  time_zone: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const cached = cache.get(time_zone);
  if (cached) return cached;
  const format = new Intl.DateTimeFormat('en-CA', { ...options, timeZone: time_zone });
  cache.set(time_zone, format);
  return format;
}

function slack_ts_to_date(ts: string): Date {
  return new Date(Number(ts) * 1000);
}

export function format_clock(ts: string, time_zone: string): string {
  const format = read_format(clock_formats, time_zone, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return format.format(slack_ts_to_date(ts));
}

export function format_day(ts: string, time_zone: string): string {
  const format = read_format(parts_formats, time_zone, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = read_date_parts(format, ts);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function format_iso_time(ts: string, time_zone: string): string {
  const format = read_format(parts_formats, time_zone, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = read_date_parts(format, ts);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${read_offset(ts, time_zone)}`;
}

function read_date_parts(format: Intl.DateTimeFormat, ts: string): Record<string, string> {
  const parts: Record<string, string> = {};
  for (const part of format.formatToParts(slack_ts_to_date(ts))) parts[part.type] = part.value;
  return parts;
}

function read_offset(ts: string, time_zone: string): string {
  const format = read_format(offset_formats, time_zone, { timeZoneName: 'longOffset' });
  const name =
    format.formatToParts(slack_ts_to_date(ts)).find((part) => part.type === 'timeZoneName')
      ?.value ?? 'GMT';
  const offset = name.replace('GMT', '');
  return offset.length === 0 ? 'Z' : offset;
}

export function read_files(message: SlackRawMessage): RenderedFile[] {
  return (message.files ?? [])
    .filter((file): file is SlackFile & { id: string } => Boolean(file.id))
    .map((file) => ({
      id: file.id,
      name: file.name ?? file.title ?? file.id,
      mime_type: file.mimetype ?? 'application/octet-stream',
      byte_size: typeof file.size === 'number' ? file.size : null,
      download_url: file.url_private_download ?? file.url_private ?? null,
    }));
}

export function read_reactions(message: SlackRawMessage): { name: string; count: number }[] {
  return (message.reactions ?? [])
    .filter((reaction) => Boolean(reaction.name))
    .map((reaction) => ({ name: reaction.name as string, count: reaction.count ?? 1 }));
}

function attachment_is_quote(attachment: SlackAttachment): boolean {
  return Boolean(
    attachment.is_msg_unfurl ||
      (attachment.message_blocks && attachment.message_blocks.length > 0) ||
      (attachment.from_url && attachment.author_name),
  );
}

export function read_forwarded_message(
  message: SlackRawMessage,
  names: UserNames,
  time_zone: string,
): ForwardedMessage | null {
  const quote = (message.attachments ?? []).find(attachment_is_quote);
  if (!quote) return null;
  const text = quote.text ?? quote.fallback ?? '';
  return {
    author: quote.author_name ?? quote.author_subname ?? null,
    channel: quote.channel_name ? `#${quote.channel_name}` : null,
    time: quote.ts ? format_iso_time(quote.ts, time_zone) : null,
    text: resolve_slack_markup(text, names),
  };
}

export function read_unfurls(message: SlackRawMessage): RenderedUnfurl[] {
  return (message.attachments ?? [])
    .filter((attachment) => !attachment_is_quote(attachment))
    .map((attachment) => ({
      url: attachment.original_url ?? attachment.from_url ?? attachment.title_link ?? '',
      title: attachment.title ?? null,
    }))
    .filter((unfurl) => unfurl.url.length > 0);
}

export type RenderLineInput = {
  message: SlackRawMessage;
  names: UserNames;
  time_zone: string;
  files: RenderedFile[];
  reactions: { name: string; count: number }[];
  unfurls: RenderedUnfurl[];
  forwarded_from: ForwardedMessage | null;
};

export function render_message_block(input: RenderLineInput): string {
  const { message, names, time_zone } = input;
  const author = find_author_name(message, names);
  const text = resolve_slack_markup(message.text ?? '', names);
  const spoken = `[${format_clock(message.ts, time_zone)}] ${author ? `${author}: ` : ''}${text}`;
  const lines = [
    (spoken + (message.edited ? ' (edited)' : '') + render_reactions(input.reactions)).trimEnd(),
  ];

  for (const file of input.files) {
    lines.push(
      `  📎 ${file.name} (${file.mime_type}, ${format_byte_size(file.byte_size)}) [file:${file.id}]`,
    );
  }
  for (const unfurl of input.unfurls) {
    lines.push(`  🔗 ${unfurl.url}${unfurl.title ? ` — "${unfurl.title}"` : ''}`);
  }
  if (input.forwarded_from) lines.push(render_forwarded_line(input.forwarded_from));
  return lines.join('\n');
}

function render_reactions(reactions: { name: string; count: number }[]): string {
  if (reactions.length === 0) return '';
  return reactions.map((reaction) => ` · :${reaction.name}: ${reaction.count}`).join('');
}

function render_forwarded_line(forwarded: ForwardedMessage): string {
  const where = forwarded.channel ?? 'DM';
  const when = forwarded.time ? `, ${forwarded.time}` : '';
  return `  ↪ forwarded from ${forwarded.author ?? 'someone'} (${where}${when}): "${forwarded.text}"`;
}

export function build_slack_permalink(input: {
  archive_origin: string | null;
  channel_id: string;
  ts: string;
  thread_ts?: string | null;
}): string | null {
  if (!input.archive_origin) return null;
  const link = `${input.archive_origin}/archives/${input.channel_id}/p${input.ts.replace('.', '')}`;
  if (!input.thread_ts || input.thread_ts === input.ts) return link;
  return `${link}?thread_ts=${input.thread_ts}&cid=${input.channel_id}`;
}

export function render_day_marker(day: string): string {
  return `— ${day} —`;
}
