import {
  build_slack_permalink,
  type ForwardedMessage,
  find_author_name,
  format_clock,
  format_day,
  format_iso_time,
  message_is_dropped,
  type RenderedFile,
  type RenderedUnfurl,
  read_files,
  read_forwarded_message,
  read_reactions,
  read_unfurls,
  render_day_marker,
  render_message_block,
  resolve_slack_markup,
  type SlackRawMessage,
  type UserNames,
} from '@connectors/apps/slack/list_messages/v1/render_message';

export type ChannelRecord = {
  record_id: string;
  ts: string;
  page_ts: string;
  time: string;
  day: string;
  document_key: string;
  day_document_key: string;
  document_title: string;
  document_url: string | null;
  permalink: string | null;
  is_thread_record: boolean;
  is_day_record: boolean;
  line: string;
  channel_id: string;
  user_id: string | null;
  bot_id: string | null;
  author_name: string | null;
  text: string;
  subtype: string | null;
  is_edited: boolean;
  files: RenderedFile[];
  file_names: string[];
  reactions: { name: string; count: number }[];
  unfurls: RenderedUnfurl[];
  forwarded_from: ForwardedMessage | null;
  thread_ts: string | null;
  reply_count: number | null;
  started_by: string | null;
  started_time: string | null;
  last_reply_time: string | null;
  thread_participants: string[];
  thread_file_count: number | null;
  thread_keys: string[];
  replies_truncated: boolean;
};

export type ThreadReplies = { replies: SlackRawMessage[]; truncated: boolean };

export type BuildRecordsInput = {
  channel_id: string;
  channel_name: string;
  archive_origin: string | null;
  messages: SlackRawMessage[];
  replies_by_parent: Map<string, ThreadReplies>;
  names: UserNames;
  time_zone: string;
};

const thread_title_text_length = 60;

export function is_thread_root(message: SlackRawMessage): boolean {
  return (message.reply_count ?? 0) > 0;
}

export function build_channel_records(input: BuildRecordsInput): ChannelRecord[] {
  const records: ChannelRecord[] = [];
  for (const message of input.messages) {
    if (message_is_dropped(message)) continue;
    if (is_thread_root(message)) records.push(...build_thread_records(message, input));
    else records.push(build_day_record(message, input));
  }
  return records;
}

function read_message_facts(message: SlackRawMessage, input: BuildRecordsInput) {
  const files = read_files(message);
  const reactions = read_reactions(message);
  const unfurls = read_unfurls(message);
  const forwarded_from = read_forwarded_message(message, input.names, input.time_zone);
  return {
    files,
    reactions,
    unfurls,
    forwarded_from,
    line: render_message_block({
      message,
      names: input.names,
      time_zone: input.time_zone,
      files,
      reactions,
      unfurls,
      forwarded_from,
    }),
    day: format_day(message.ts, input.time_zone),
    time: format_iso_time(message.ts, input.time_zone),
  };
}

type MessageFacts = ReturnType<typeof read_message_facts>;

type RecordSeed = {
  message: SlackRawMessage;
  facts: MessageFacts;
  page_ts: string;
  document_key: string;
  document_title: string;
  document_url: string | null;
  line: string;
};

function build_record(seed: RecordSeed, input: BuildRecordsInput): ChannelRecord {
  const { message, facts } = seed;
  const day_document_key = `day:${input.channel_id}:${facts.day}`;
  const is_thread_record = seed.document_key.startsWith('thread:');
  return {
    record_id: `${seed.document_key}#${message.ts}`,
    ts: message.ts,
    page_ts: seed.page_ts,
    time: facts.time,
    day: facts.day,
    document_key: seed.document_key,
    day_document_key,
    document_title: seed.document_title,
    document_url: seed.document_url,
    permalink: build_slack_permalink({
      archive_origin: input.archive_origin,
      channel_id: input.channel_id,
      ts: message.ts,
      thread_ts: message.thread_ts ?? null,
    }),
    is_thread_record,
    is_day_record: !is_thread_record,
    line: seed.line,
    channel_id: input.channel_id,
    user_id: message.user ?? null,
    bot_id: message.bot_id ?? null,
    author_name: find_author_name(message, input.names),
    text: message.text ?? '',
    subtype: message.subtype ?? null,
    is_edited: Boolean(message.edited),
    files: facts.files,
    file_names: facts.files.map((file) => file.name),
    reactions: facts.reactions,
    unfurls: facts.unfurls,
    forwarded_from: facts.forwarded_from,
    thread_ts: message.thread_ts ?? null,
    reply_count: null,
    started_by: null,
    started_time: null,
    last_reply_time: null,
    thread_participants: [],
    thread_file_count: null,
    thread_keys: [],
    replies_truncated: false,
  };
}

function build_day_record(message: SlackRawMessage, input: BuildRecordsInput): ChannelRecord {
  const facts = read_message_facts(message, input);
  return build_record(
    {
      message,
      facts,
      page_ts: message.ts,
      document_key: `day:${input.channel_id}:${facts.day}`,
      document_title: `#${input.channel_name} — ${facts.day}`,
      document_url: day_document_url(input),
      line: facts.line,
    },
    input,
  );
}

function day_document_url(input: BuildRecordsInput): string | null {
  return input.archive_origin ? `${input.archive_origin}/archives/${input.channel_id}` : null;
}

function build_thread_records(root: SlackRawMessage, input: BuildRecordsInput): ChannelRecord[] {
  const read = input.replies_by_parent.get(root.ts);
  const replies = (read?.replies ?? []).filter((reply) => !message_is_dropped(reply));
  const root_facts = read_message_facts(root, input);
  const thread_key = `thread:${input.channel_id}:${root.thread_ts ?? root.ts}`;
  const thread_url = build_slack_permalink({
    archive_origin: input.archive_origin,
    channel_id: input.channel_id,
    ts: root.ts,
  });
  const title = build_thread_title(root, input);

  const seeds: RecordSeed[] = [
    {
      message: root,
      facts: root_facts,
      page_ts: root.ts,
      document_key: thread_key,
      document_title: title,
      document_url: thread_url,
      line: root_facts.line,
    },
  ];

  let previous_day = root_facts.day;
  for (const reply of replies) {
    const facts = read_message_facts(reply, input);
    const line =
      facts.day === previous_day ? facts.line : `${render_day_marker(facts.day)}\n${facts.line}`;
    previous_day = facts.day;
    seeds.push({
      message: reply,
      facts,
      page_ts: root.ts,
      document_key: thread_key,
      document_title: title,
      document_url: thread_url,
      line,
    });
  }

  const last_seed = seeds.at(-1);
  if (read?.truncated && last_seed) {
    const missing = Math.max((root.reply_count ?? 0) - replies.length, 0);
    last_seed.line = `${last_seed.line}\n… ${missing} more replies not shown`;
  }

  const thread_facts = read_thread_facts(
    root,
    replies,
    root_facts,
    input,
    read?.truncated ?? false,
  );
  const records: ChannelRecord[] = seeds.map((seed) => ({
    ...build_record(seed, input),
    ...thread_facts,
  }));
  records.push(build_thread_stub(root, root_facts, thread_facts, thread_key, input));
  return records;
}

function read_thread_facts(
  root: SlackRawMessage,
  replies: SlackRawMessage[],
  root_facts: MessageFacts,
  input: BuildRecordsInput,
  replies_truncated: boolean,
) {
  const last_reply = replies.at(-1);
  const reply_authors = replies
    .map((reply) => find_author_name(reply, input.names))
    .filter((name): name is string => name !== null);
  const starter = find_author_name(root, input.names);
  const reply_files = replies.reduce((total, reply) => total + read_files(reply).length, 0);
  return {
    thread_ts: root.thread_ts ?? root.ts,
    reply_count: root.reply_count ?? replies.length,
    started_by: starter,
    started_time: root_facts.time,
    last_reply_time: last_reply ? format_iso_time(last_reply.ts, input.time_zone) : root_facts.time,
    thread_participants: [...new Set([...(starter ? [starter] : []), ...reply_authors])],
    thread_file_count: root_facts.files.length + reply_files,
    replies_truncated,
  };
}

type ThreadFacts = ReturnType<typeof read_thread_facts>;

function build_thread_stub(
  root: SlackRawMessage,
  root_facts: MessageFacts,
  thread_facts: ThreadFacts,
  thread_key: string,
  input: BuildRecordsInput,
): ChannelRecord {
  const author = find_author_name(root, input.names);
  const text = resolve_slack_markup(root.text ?? '', input.names);
  const line =
    `[${format_clock(root.ts, input.time_zone)}] ${author ? `${author}: ` : ''}${text}` +
    ` ↳ thread · ${thread_facts.reply_count} replies · last ${thread_facts.last_reply_time}` +
    ` · [${thread_key}]`;

  const record = build_record(
    {
      message: root,
      facts: root_facts,
      page_ts: root.ts,
      document_key: `day:${input.channel_id}:${root_facts.day}`,
      document_title: `#${input.channel_name} — ${root_facts.day}`,
      document_url: day_document_url(input),
      line,
    },
    input,
  );
  return { ...record, ...thread_facts, thread_keys: [thread_key] };
}

function build_thread_title(root: SlackRawMessage, input: BuildRecordsInput): string {
  const starter = find_author_name(root, input.names) ?? 'someone';
  const text = resolve_slack_markup(root.text ?? '', input.names)
    .replace(/\s+/gu, ' ')
    .trim();
  const shortened =
    text.length > thread_title_text_length ? `${text.slice(0, thread_title_text_length)}…` : text;
  return `#${input.channel_name} · ${starter}: "${shortened}"`;
}
