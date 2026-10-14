import { automation_filter_fields } from '@runtime-platform/tools/definitions/automations_support';
import { z } from 'zod';

const session_sources = ['dashboard', 'slack', 'email', 'api', 'trigger', 'system'] as const;

const session_index_limit_maximum = 100;
const session_message_limit_maximum = 50;
const session_search_limit_maximum = 50;

const source_field = z
  .enum(session_sources)
  .optional()
  .describe('Only conversations that started on this channel.');

const since_field = z
  .string()
  .datetime()
  .optional()
  .describe('ISO time. Only conversations with activity at or after it.');

export const list_sessions_input_schema = z.strictObject({
  source: source_field,
  since: since_field,
  ...automation_filter_fields,
  limit: z.coerce.number().int().min(1).max(session_index_limit_maximum).default(25),
});

export const read_session_messages_input_schema = z.strictObject({
  session_id: z.string().min(1).describe('The conversation to read, from list_sessions.'),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(session_message_limit_maximum)
    .default(20)
    .describe('How many of the newest messages to read.'),
});

export const search_session_messages_input_schema = z.strictObject({
  query: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe('Words to look for in what was said. Ordinary search words, not SQL.'),
  session_id: z.string().min(1).optional().describe('Only inside this one conversation.'),
  source: source_field,
  since: since_field,
  ...automation_filter_fields,
  limit: z.coerce.number().int().min(1).max(session_search_limit_maximum).default(20),
});

export const list_active_runs_input_schema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(session_index_limit_maximum).default(25),
});

const session_summary_schema = z.strictObject({
  session_id: z.string(),
  title: z.string().nullable(),
  source: z.string(),
  project_id: z.string().nullable(),
  last_message_time: z.string().nullable(),
  status: z.enum(['running', 'idle']),
});

export const list_sessions_output_schema = z.strictObject({
  count: z.number(),
  sessions: z.array(session_summary_schema),
});

const message_tool_call_schema = z.strictObject({
  tool_call_id: z.string().nullable(),
  name: z.string(),
  input_preview: z.string(),
});

const message_tool_result_schema = z.strictObject({
  tool_call_id: z.string().nullable(),
  name: z.string().nullable(),
  result_preview: z.string(),
});

const message_file_schema = z.strictObject({
  file_id: z.string().nullable(),
  name: z.string().nullable(),
  path: z.string().nullable(),
  mime_type: z.string().nullable(),
});

const session_message_schema = z.strictObject({
  message_sequence: z.number(),
  role: z.string(),
  created_time: z.string(),
  text: z.string().nullable(),
  tool_calls: z.array(message_tool_call_schema),
  tool_results: z.array(message_tool_result_schema),
  files: z.array(message_file_schema),
  image_count: z.number(),
});

export const read_session_messages_output_schema = z.strictObject({
  session_id: z.string(),
  title: z.string().nullable(),
  source: z.string(),
  count: z.number(),
  messages: z.array(session_message_schema),
});

const session_message_match_schema = z.strictObject({
  session_id: z.string(),
  session_title: z.string().nullable(),
  session_source: z.string(),
  message_sequence: z.number(),
  last_message_time: z.string().nullable(),
  snippet: z.string(),
});

export const search_session_messages_output_schema = z.strictObject({
  count: z.number(),
  matches: z.array(session_message_match_schema),
});

const active_run_schema = z.strictObject({
  run_id: z.string(),
  session_id: z.string(),
  session_title: z.string().nullable(),
  session_source: z.string(),
  run_status: z.string(),
  run_reason: z.string(),
  automation_id: z.string().nullable(),
  automation_name: z.string().nullable(),
  started_time: z.string().nullable(),
  created_time: z.string(),
});

export const list_active_runs_output_schema = z.strictObject({
  count: z.number(),
  runs: z.array(active_run_schema),
});
