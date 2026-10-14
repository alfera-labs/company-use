import { search_session_messages } from '@coworker/core/db/queries/session_message_search';
import { list_session_message_page } from '@coworker/core/db/queries/session_read_pages';
import {
  find_visible_session,
  list_visible_sessions,
} from '@coworker/core/db/queries/visible_sessions';
import {
  input_json_schema,
  output_json_schema,
  read_automation_context,
  read_automation_filter,
  session_filter_names,
  tool_error,
} from '@runtime-platform/tools/definitions/automations_support';
import { list_active_runs_tool } from '@runtime-platform/tools/definitions/session_active_runs';
import {
  list_sessions_input_schema,
  list_sessions_output_schema,
  read_session_messages_input_schema,
  read_session_messages_output_schema,
  search_session_messages_input_schema,
  search_session_messages_output_schema,
} from '@runtime-platform/tools/definitions/sessions_schemas';
import {
  summarize_message_match,
  summarize_session_message,
  summarize_visible_session,
} from '@runtime-platform/tools/definitions/sessions_support';
import { restore_run_message_tool_results } from '@runtime-platform/tools/stored_tool_result_reads';
import type { RuntimeToolDefinition } from '@runtime-platform/tools/types';

const sessions_app_name = 'sessions';

export { list_active_runs_tool };

export const list_sessions_tool: RuntimeToolDefinition<typeof list_sessions_input_schema> = {
  node_key: 'sessions-list_sessions-1',
  node_name: 'list_sessions',
  display_name: 'List conversations',
  description: [
    'Lists the workspace conversations you may read: id, channel, title, when it last moved, and whether a run is working it right now.',
    'Use it to find the thread something belongs to before opening a new one, or to see what has happened since a time.',
    'It returns no message text — read_session_messages does that for one conversation.',
  ].join(' '),
  category: 'context',
  input_schema: input_json_schema(list_sessions_input_schema),
  output_schema: output_json_schema(list_sessions_output_schema),
  app_name: sessions_app_name,
  required_connection: false,
  runtime_handler: 'sessions.list_sessions',
  approval_policy: { mode: 'none' },
  metadata: { safe_for_first_milestone: true },
  validate_input: list_sessions_input_schema,
  async execute(input, context) {
    const parsed_context = read_automation_context(context, 'sessions-list_sessions-1');
    if (!parsed_context.success) return parsed_context;
    const ctx = parsed_context.data;

    const rows = await list_visible_sessions(ctx.db, {
      workspace_id: ctx.workspace_id,
      reader_user_id: ctx.actor_id,
      ...(input.source ? { session_source: input.source } : {}),
      ...(input.since ? { since: new Date(input.since) } : {}),
      ...read_automation_filter(input),
      limit: input.limit,
    });
    const sessions = rows.map(summarize_visible_session);

    return {
      success: true,
      data: list_sessions_output_schema.parse({ count: sessions.length, sessions }),
    };
  },
};

export const read_session_messages_tool: RuntimeToolDefinition<
  typeof read_session_messages_input_schema
> = {
  node_key: 'sessions-read_session_messages-1',
  node_name: 'read_session_messages',
  display_name: 'Read conversation messages',
  description: [
    'Reads the newest messages of ONE conversation you may see, with the tool calls summarized and files named rather than carried.',
    'Use it after list_sessions or search_session_messages, when you need to know what was actually said before acting on the same subject.',
  ].join(' '),
  category: 'context',
  input_schema: input_json_schema(read_session_messages_input_schema),
  output_schema: output_json_schema(read_session_messages_output_schema),
  app_name: sessions_app_name,
  required_connection: false,
  runtime_handler: 'sessions.read_session_messages',
  approval_policy: { mode: 'none' },
  metadata: { safe_for_first_milestone: true },
  validate_input: read_session_messages_input_schema,
  async execute(input, context) {
    const parsed_context = read_automation_context(context, 'sessions-read_session_messages-1');
    if (!parsed_context.success) return parsed_context;
    const ctx = parsed_context.data;

    const session = await find_visible_session(ctx.db, {
      workspace_id: ctx.workspace_id,
      session_id: input.session_id,
      reader_user_id: ctx.actor_id,
    });
    if (!session) {
      return tool_error(
        'session_not_found',
        `No conversation ${input.session_id} you may read. Find one with list_sessions.`,
      );
    }

    const page = await list_session_message_page(ctx.db, {
      workspace_id: ctx.workspace_id,
      session_id: session.session_id,
      limit: input.limit * 2,
    });
    const restored = await restore_run_message_tool_results(ctx.db, {
      workspace_id: ctx.workspace_id,
      rows: page.items,
      reading: 'load_full_value',
    });
    const messages = restored
      .filter((message) => message.is_user_visible)
      .slice(-input.limit)
      .map(summarize_session_message);

    return {
      success: true,
      data: read_session_messages_output_schema.parse({
        session_id: session.session_id,
        title: session.session_title,
        source: session.session_source,
        count: messages.length,
        messages,
      }),
    };
  },
};

export const search_session_messages_tool: RuntimeToolDefinition<
  typeof search_session_messages_input_schema
> = {
  node_key: 'sessions-search_session_messages-1',
  node_name: 'search_session_messages',
  display_name: 'Search conversations',
  description: [
    'Finds where something was said across the conversations you may read, and returns the matching line with the conversation it belongs to.',
    `Narrow it with ${session_filter_names}. Open what it finds with read_session_messages.`,
  ].join(' '),
  category: 'context',
  input_schema: input_json_schema(search_session_messages_input_schema),
  output_schema: output_json_schema(search_session_messages_output_schema),
  app_name: sessions_app_name,
  required_connection: false,
  runtime_handler: 'sessions.search_session_messages',
  approval_policy: { mode: 'none' },
  metadata: { safe_for_first_milestone: true },
  validate_input: search_session_messages_input_schema,
  async execute(input, context) {
    const parsed_context = read_automation_context(context, 'sessions-search_session_messages-1');
    if (!parsed_context.success) return parsed_context;
    const ctx = parsed_context.data;

    const rows = await search_session_messages(ctx.db, {
      workspace_id: ctx.workspace_id,
      user_id: ctx.actor_id,
      query_text: input.query,
      limit: input.limit,
      ...(input.session_id ? { session_id: input.session_id } : {}),
      ...(input.source ? { session_source: input.source } : {}),
      ...(input.since ? { since: new Date(input.since) } : {}),
      ...read_automation_filter(input),
    });
    const matches = rows.map(summarize_message_match);

    return {
      success: true,
      data: search_session_messages_output_schema.parse({ count: matches.length, matches }),
    };
  },
};

export const session_tools = [
  list_sessions_tool,
  read_session_messages_tool,
  search_session_messages_tool,
  list_active_runs_tool,
] satisfies RuntimeToolDefinition[];
