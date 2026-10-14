import type { ChatStreamEvent, ToolCallItem } from '@coworker/shared';
import { create_logger, find_tool_call_subjects, format_error_message } from '@coworker/shared';
import { z } from 'zod';

const log = create_logger('slack_live_status');

const min_interval_ms = 2_000;

export type AppNameLookup = (node_key: string) => Promise<string | null>;

const execute_input_schema = z.object({ node_key: z.string().min(1) }).catch({ node_key: '' });

export async function slack_status_for_event(
  event: ChatStreamEvent,
  app_name_for: AppNameLookup,
): Promise<string | null> {
  if (event.event_type !== 'item_started') return null;
  const item = event.item;
  if (item.item_type === 'thinking') return 'Thinking…';
  if (item.item_type === 'assistant_message') return 'Writing the answer…';
  if (item.item_type !== 'tool_call') return null;
  return `${await words_for_tool(item, app_name_for)}…`;
}

async function words_for_tool(tool: ToolCallItem, app_name_for: AppNameLookup) {
  const name = tool.tool_name.replace(/-\d+$/u, '');
  if (/search_tools|get_tool_schema/u.test(name)) return 'Finding the right tool';
  if (/run_program/u.test(name)) return 'Running a program';
  if (/web_search|search_web/u.test(name)) return 'Searching the web';
  if (/fetch|read_url|browse/u.test(name)) return reading_what(tool.input_data);
  if (/search_documents|search_context/u.test(name)) return 'Looking through your documents';
  if (tool.tool_kind === 'command') return 'Running a command';
  if (tool.tool_kind === 'file') return 'Working on files';
  if (tool.tool_kind === 'browser') return 'Using the browser';
  const node_key = execute_input_schema.parse(tool.input_data).node_key || tool.tool_name;
  const app_name = await app_name_for(node_key).catch((error) => {
    log.warn('slack live status app name lookup failed', {
      node_key,
      error: format_error_message(error),
    });
    return null;
  });
  return app_name ? `Working in ${app_name}` : 'Working';
}

function reading_what(input: unknown) {
  const website = find_tool_call_subjects(input).find((subject) => subject.kind === 'website');
  return website ? `Reading ${website.display_name}` : 'Reading a web page';
}

async function set_status_or_log(set_status: (status: string) => Promise<void>, status: string) {
  await set_status(status).catch((error) =>
    log.warn('slack live status update failed', { status, error: format_error_message(error) }),
  );
}

export function create_slack_live_status(input: {
  set_status: (status: string) => Promise<void>;
  app_name_for: AppNameLookup;
  now?: () => number;
}) {
  const now = input.now ?? Date.now;
  let last_sent = '';
  let last_time = Number.NEGATIVE_INFINITY;
  let waiting: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const send = async (status: string) => {
    if (stopped || status === last_sent) return;
    last_sent = status;
    last_time = now();
    await set_status_or_log(input.set_status, status);
  };

  const flush_later = () => {
    if (timer) return;
    timer = setTimeout(
      () => {
        timer = null;
        const status = waiting;
        waiting = null;
        if (status) void send(status);
      },
      Math.max(0, min_interval_ms - (now() - last_time)),
    );
  };

  return {
    async on_event(event: ChatStreamEvent) {
      if (stopped) return;
      const status = await slack_status_for_event(event, input.app_name_for);
      if (!status || status === last_sent) return;
      if (now() - last_time >= min_interval_ms && !timer) return send(status);
      waiting = status;
      flush_later();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
