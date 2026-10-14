import type { Database, event_jobs, events } from '@coworker/core';
import type { EventJobHandlerResult } from '@coworker/jobs';
import { calculate_backoff_delay, create_logger, format_error_message } from '@coworker/shared';
import { load_slack_user_directory } from '@runtime-platform/channels/slack/directory';
import {
  prepare_slack_discovery_window,
  type SlackDiscoveryWindow,
  update_slack_discovery_checkpoint,
} from '@runtime-platform/channels/slack/discovery_checkpoint';
import {
  fetch_slack_channel_history_page,
  fetch_slack_thread_replies_page,
  find_workspace_slack_connection,
  read_slack_bot_token,
  type SlackHistoryMessage,
} from '@runtime-platform/channels/slack/history';
import { make_channel_activity_summarizer } from '@runtime-platform/discovery/channel_digest';
import {
  digest_sample_line,
  is_written_by_a_person,
} from '@runtime-platform/discovery/channel_message_line';
import type { SlackDiscoveryChannelEventBody } from '@runtime-platform/events/slack_discovery_event_payload';

type EventRecord = typeof events.$inferSelect;
type EventJob = typeof event_jobs.$inferSelect;

type SlackDiscoveryChannelJobInput = {
  db: Database;
  workspace_id: string;
  queue_key: string;
  event_jobs: EventJob[];
  events: EventRecord[];
  heartbeat: () => Promise<void>;
};

type ChannelHistoryInput = {
  token: string;
  workspace_id: string;
  connection_id: string;
  channel_id: string;
  channel_name?: string | null;
  name_by_id: Map<string, string>;
  heartbeat: () => Promise<void>;
};

type ChannelDiscoveryTotals = {
  messages_scanned: number;
  digest_text: string | null;
  scan_truncated: boolean;
  threads_scanned: number;
  last_message_ts: string | null;
  thread_parent_ts: string[];
  digest_sample_lines: string[];
};

const log = create_logger('slack_discovery_channel');
const max_channel_attempts = 5;
const max_digest_sample_lines = 300;
const max_messages_per_channel_per_run = 999;
const max_threads_per_channel_per_run = 25;
const max_replies_per_thread = 200;
// Slack's conversations.replies is tier-3. A small fixed pool per channel job keeps a wide fan-out
// polite while still beating a sequential walk.
const thread_fetch_concurrency = 4;

export async function run_slack_discovery_channel_job(
  input: SlackDiscoveryChannelJobInput,
): Promise<EventJobHandlerResult> {
  const { db, workspace_id, heartbeat } = input;
  const channel_context = read_channel_context(input.events);
  const connection = await find_workspace_slack_connection(
    db,
    workspace_id,
    channel_context.connection_id,
  );
  const token = connection ? read_slack_bot_token(connection.credentials) : null;
  if (!channel_context.channel_id || !connection || !token) {
    return { job_status: 'failed', error_data: { code: 'channel_discovery_unconfigured' } };
  }

  const name_by_id = await load_name_map(token);
  try {
    const totals = await discover_channel_history(db, {
      token,
      workspace_id,
      connection_id: connection.connection_id,
      channel_id: channel_context.channel_id,
      channel_name: channel_context.channel_name,
      name_by_id,
      heartbeat,
    });
    return {
      job_status: 'done',
      result_data: {
        channel_id: channel_context.channel_id,
        channel_label: channel_label_for(channel_context),
        ...totals,
      },
    };
  } catch (error) {
    return channel_failure_result(input.event_jobs, channel_context.channel_id, error);
  }
}

async function discover_channel_history(db: Database, input: ChannelHistoryInput) {
  const scan_window = await prepare_slack_discovery_window(db, {
    workspace_id: input.workspace_id,
    connection_id: input.connection_id,
    channel_id: input.channel_id,
  });
  const totals = create_channel_discovery_totals();
  let cursor: string | undefined;

  do {
    const remaining = max_messages_per_channel_per_run - totals.messages_scanned;
    const page = await fetch_slack_channel_history_page(input.token, {
      ...channel_history_page_request(input, scan_window, cursor),
      limit: Math.min(200, remaining),
    });
    totals.last_message_ts = latest_slack_ts(totals.last_message_ts, page.messages);
    collect_thread_parents(totals, page.messages);
    collect_digest_sample(totals, page.messages, input.name_by_id);
    totals.messages_scanned += page.messages.length;
    cursor = page.next_cursor ?? undefined;
    await input.heartbeat();
  } while (cursor && totals.messages_scanned < max_messages_per_channel_per_run);

  totals.scan_truncated = Boolean(cursor);
  await collect_thread_digest_samples(input, totals);
  totals.digest_text = await summarize_channel(input, totals);
  await save_channel_discovery_checkpoint(db, input, scan_window, totals);
  return channel_discovery_result(totals, scan_window);
}

function create_channel_discovery_totals(): ChannelDiscoveryTotals {
  return {
    messages_scanned: 0,
    digest_text: null,
    scan_truncated: false,
    threads_scanned: 0,
    last_message_ts: null,
    thread_parent_ts: [],
    digest_sample_lines: [],
  };
}

function channel_history_page_request(
  input: ChannelHistoryInput,
  scan_window: SlackDiscoveryWindow,
  cursor?: string,
) {
  return {
    channel_id: input.channel_id,
    ...(cursor ? { cursor } : {}),
    ...(scan_window.oldest_ts ? { oldest: scan_window.oldest_ts, inclusive: true } : {}),
    latest: scan_window.latest_ts,
  };
}

async function map_with_concurrency<T, R>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next_index = 0;
  const worker = async () => {
    while (next_index < items.length) {
      const index = next_index++;
      results[index] = await run(items[index] as T);
    }
  };
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

// A thread parent carries thread_ts equal to its own ts; plain messages carry none. Replies are
// NOT in conversations.history, so parents are collected here and their threads fetched after.
function collect_thread_parents(totals: ChannelDiscoveryTotals, messages: SlackHistoryMessage[]) {
  for (const message of messages) {
    if (totals.thread_parent_ts.length >= max_threads_per_channel_per_run) return;
    if (message.thread_ts === message.message_ts) totals.thread_parent_ts.push(message.message_ts);
  }
}

async function collect_thread_digest_samples(
  input: ChannelHistoryInput,
  totals: ChannelDiscoveryTotals,
) {
  const thread_pages = await map_with_concurrency(
    totals.thread_parent_ts,
    thread_fetch_concurrency,
    async (thread_ts) => {
      try {
        const thread = await fetch_slack_thread_replies_page(input.token, {
          channel_id: input.channel_id,
          thread_ts,
          limit: max_replies_per_thread,
        });
        const plain = thread.messages.filter(is_written_by_a_person);
        if (plain.length < 2) return [];
        totals.threads_scanned += 1;
        return plain.slice(1);
      } catch (error) {
        log.error('thread scan failed, continuing', {
          channel_id: input.channel_id,
          thread_ts,
          error: format_error_message(error),
        });
        return [];
      } finally {
        await input.heartbeat();
      }
    },
  );
  for (const replies of thread_pages) {
    collect_digest_sample(totals, replies, input.name_by_id);
  }
}

function collect_digest_sample(
  totals: ChannelDiscoveryTotals,
  messages: SlackHistoryMessage[],
  name_by_id: Map<string, string>,
) {
  for (const message of messages) {
    if (totals.digest_sample_lines.length >= max_digest_sample_lines) return;
    if (!is_written_by_a_person(message)) continue;
    totals.digest_sample_lines.push(digest_sample_line(message, name_by_id));
  }
}

async function load_name_map(token: string): Promise<Map<string, string>> {
  try {
    const directory = await load_slack_user_directory(token);
    return directory.name_by_id;
  } catch (error) {
    log.error('user directory lookup failed, using raw ids', {
      error: format_error_message(error),
    });
    return new Map();
  }
}

async function summarize_channel(
  input: ChannelHistoryInput,
  totals: ChannelDiscoveryTotals,
): Promise<string | null> {
  if (totals.digest_sample_lines.length === 0) return null;
  try {
    return await make_channel_activity_summarizer().summarize({
      workspace_id: input.workspace_id,
      channel_label: input.channel_name ? `#${input.channel_name}` : input.channel_id,
      message_lines: totals.digest_sample_lines,
    });
  } catch (error) {
    log.error('channel digest failed, keeping the scan', {
      channel_id: input.channel_id,
      error: format_error_message(error),
    });
    return null;
  }
}

async function save_channel_discovery_checkpoint(
  db: Database,
  input: ChannelHistoryInput,
  scan_window: SlackDiscoveryWindow,
  totals: ChannelDiscoveryTotals,
) {
  await update_slack_discovery_checkpoint(db, {
    workspace_id: input.workspace_id,
    connection_id: input.connection_id,
    channel_id: input.channel_id,
    channel_name: input.channel_name ?? null,
    scanned_until_ts: scan_window.latest_ts,
    last_message_ts: totals.last_message_ts,
    messages_scanned: totals.messages_scanned,
  });
}

function channel_discovery_result(
  totals: ChannelDiscoveryTotals,
  scan_window: SlackDiscoveryWindow,
) {
  return {
    messages_scanned: totals.messages_scanned,
    digest_text: totals.digest_text,
    scan_truncated: totals.scan_truncated,
    threads_scanned: totals.threads_scanned,
    discovery_oldest_ts: scan_window.oldest_ts,
    discovery_latest_ts: scan_window.latest_ts,
    discovery_checkpoint_key: scan_window.checkpoint_key,
  };
}

function latest_slack_ts(current: string | null, messages: SlackHistoryMessage[]) {
  return messages.reduce((latest, message) => {
    if (!latest) return message.message_ts;
    return Number.parseFloat(message.message_ts) > Number.parseFloat(latest)
      ? message.message_ts
      : latest;
  }, current);
}

function channel_label_for(context: { channel_id: string | null; channel_name: string | null }) {
  return context.channel_name ? `#${context.channel_name}` : (context.channel_id ?? 'a channel');
}

function read_channel_context(event_records: EventRecord[]) {
  for (const record of event_records) {
    const body = record.event_body as SlackDiscoveryChannelEventBody | null;
    if (body?.channel_id) {
      return {
        channel_id: body.channel_id,
        connection_id: body.connection_id,
        channel_name: body.channel_name ?? null,
      };
    }
  }
  return { channel_id: null, channel_name: null };
}

function channel_failure_result(
  channel_jobs: EventJob[],
  channel_id: string,
  error: unknown,
): EventJobHandlerResult {
  const attempt = Math.max(...channel_jobs.map((job) => job.attempt_count), 1);
  const message = format_error_message(error, 'Channel discovery failed.');
  if (attempt >= max_channel_attempts) {
    return {
      job_status: 'failed',
      error_data: { code: 'channel_discovery_exhausted', channel_id, message },
    };
  }
  return {
    job_status: 'failed',
    retry_at: new Date(
      Date.now() + calculate_backoff_delay(attempt, { base_ms: 2_000, max_ms: 300_000 }),
    ),
    error_data: { code: 'channel_discovery_retry', channel_id, message, attempt },
  };
}
