import path from 'node:path';
import type { Database } from '@coworker/core';
import type {
  ConnectionConfigData,
  ConnectionCredentialData,
  ProviderAccountData,
} from '@coworker/core/db/schema/json_column_types';
import { create_logger, format_error_message, type RuntimeToolResult } from '@coworker/shared';
import { create_slack_attachment_sources } from '@runtime-platform/channels/slack/attachment_sources';
import { read_slack_channel_files } from '@runtime-platform/channels/slack/channel_routing';
import {
  load_slack_user_directory,
  type SlackMember,
  type SlackUserDirectory,
} from '@runtime-platform/channels/slack/directory';
import { slack_message_text_from_markdown } from '@runtime-platform/channels/slack/message_format';
import {
  current_workspace_layout,
  workspace_path_is_durable,
} from '@runtime-platform/storage/workspace_layouts';
import { runtime_read_attachment_tool } from '@runtime-platform/tools/definitions/runtime_read_attachment';
import {
  create_slack_web_client,
  read_slack_bot_token,
} from '@runtime-platform/tools/slack/channels_api';
import type {
  RuntimeCatalogToolInput,
  RuntimeToolExecutionContext,
  RuntimeToolSourceContext,
} from '@runtime-platform/tools/types';
import { find_uncalculated_formula_cells } from '@runtime-platform/workbooks/find_uncalculated_formula_cells';
import type { WebClient } from '@slack/web-api';

const log = create_logger('native_slack_upload');

type SlackTool = {
  node_key: string;
  app_name: string;
  node_name: string;
  node_id: string;
  runtime_handler: string;
};

type SlackConnection = {
  connection_id: string;
  credentials?: ConnectionCredentialData | null;
  external_account_id?: string | null;
  provider_account?: ProviderAccountData;
  connection_config?: ConnectionConfigData;
};

type SlackApiResponse = {
  ok?: boolean;
  error?: string;
  response_metadata?: { next_cursor?: string };
  channels?: unknown[];
  files?: unknown[];
  already_in_channel?: boolean;
  channel?: string | { id?: string };
  ts?: string;
  message?: unknown;
  messages?: SlackHistoryMessage[];
  has_more?: boolean;
};

type SlackHistoryMessage = {
  ts?: string;
  text?: string;
  user?: string;
  thread_ts?: string;
  files?: unknown;
};

type SlackSdkError = Error & {
  code?: string;
  data?: { error?: string };
};

type NativeSlackInput = {
  db: Database;
  workspace_id: string;
  session_id: string;
  run_id: string;
  actor_id: string;
  node_key: string;
  tool_input: RuntimeCatalogToolInput;
  environment?: RuntimeToolExecutionContext['environment'];
  source_context?: RuntimeToolSourceContext;
};

type NativeSlackExecutor = (
  input: NativeSlackInput,
  tool: SlackTool,
  connection: SlackConnection | null,
  token: string,
) => Promise<RuntimeToolResult>;

const native_slack_executors: Record<string, NativeSlackExecutor> = {
  'slack.list_channels': list_slack_channels,
  'slack.list_workspace_members': list_slack_workspace_members,
  'slack.read_file': read_slack_file,
  'slack.read_history': read_slack_history,
  'slack.join_channel': join_slack_channel,
  'slack.send_message': send_slack_message,
  'slack.upload_file': upload_slack_file,
};

export async function execute_native_slack_tool(
  input: NativeSlackInput,
  tool: SlackTool,
  connection: SlackConnection | null,
): Promise<RuntimeToolResult> {
  const token = read_slack_bot_token(connection);
  if (!token) {
    return slack_error('connection_incomplete', 'Slack connection is missing a bot token.', {
      connection_id: connection?.connection_id ?? null,
      node_id: tool.node_id,
    });
  }

  const execute = native_slack_executors[tool.runtime_handler];
  if (execute) return execute(input, tool, connection, token);

  return slack_error('unsupported_slack_tool', `${input.node_key} is not a native Slack tool.`, {
    runtime_handler: tool.runtime_handler,
    node_id: tool.node_id,
  });
}

async function list_slack_channels(
  input: NativeSlackInput,
  tool: SlackTool,
  connection: SlackConnection | null,
  token: string,
): Promise<RuntimeToolResult> {
  let response: SlackApiResponse;
  try {
    response = await create_slack_web_client(token).conversations.list({
      limit: input.tool_input.limit ?? 20,
      types: 'public_channel,private_channel',
      exclude_archived: true,
      ...(typeof input.tool_input.cursor === 'string' ? { cursor: input.tool_input.cursor } : {}),
    });
  } catch (error) {
    return slack_sdk_error(error, tool, connection);
  }
  if (response.ok === false) return slack_api_error(response, tool, connection);

  return slack_success(input, tool, connection, {
    channels: response.channels ?? [],
    next_cursor: response.response_metadata?.next_cursor ?? null,
  });
}

async function list_slack_workspace_members(
  input: NativeSlackInput,
  tool: SlackTool,
  connection: SlackConnection | null,
  token: string,
): Promise<RuntimeToolResult> {
  let directory: SlackUserDirectory;
  try {
    directory = await load_slack_user_directory(token);
  } catch (error) {
    return slack_sdk_error(error, tool, connection);
  }

  const { members } = directory;
  const humans = members.filter((member) => !member.is_bot);
  const bots = members.filter((member) => member.is_bot);
  const include_bots = input.tool_input.include_bots === true;
  const limit = Math.min(Math.max(input.tool_input.limit ?? 200, 1), 500);
  const returned_members = (include_bots ? members : humans).slice(0, limit);

  return slack_success(input, tool, connection, {
    human_member_count: humans.length,
    bot_count: bots.length,
    counts_are_complete: !directory.truncated,
    directory_truncated: directory.truncated,
    directory_pages_loaded: directory.loaded_pages,
    returned_member_count: returned_members.length,
    members: returned_members.map(member_output),
  });
}

function member_output(member: SlackMember) {
  return {
    user_id: member.user_id,
    real_name: member.real_name,
    display_name: member.display_name,
    email: member.email,
    timezone: member.timezone,
    is_bot: member.is_bot,
  };
}

async function read_slack_history(
  input: NativeSlackInput,
  tool: SlackTool,
  connection: SlackConnection | null,
  token: string,
): Promise<RuntimeToolResult> {
  const channel_id = require_slack_input_text(input.tool_input.channel_id, 'channel_id');
  const thread_ts = input.tool_input.thread_ts;
  const hours_back = Math.min(
    Math.max(input.tool_input.hours_back ?? slack_history_default_hours_back, 1),
    24 * 90,
  );
  const limit = Math.min(Math.max(input.tool_input.limit ?? 50, 1), 100);
  const cursor = input.tool_input.cursor;
  const oldest = `${Math.floor((Date.now() - hours_back * 60 * 60 * 1000) / 1000)}.000000`;

  let response: SlackApiResponse;
  try {
    const client = create_slack_web_client(token);
    response = thread_ts
      ? await client.conversations.replies({
          channel: channel_id,
          ts: thread_ts,
          limit,
          ...(cursor ? { cursor } : {}),
        })
      : await client.conversations.history({
          channel: channel_id,
          oldest,
          limit,
          ...(cursor ? { cursor } : {}),
        });
  } catch (error) {
    return slack_sdk_error(error, tool, connection);
  }
  if (response.ok === false) return slack_api_error(response, tool, connection);

  const next_cursor = response.response_metadata?.next_cursor ?? null;
  return slack_success(input, tool, connection, {
    channel_id,
    thread_ts: thread_ts ?? null,
    messages: (response.messages ?? []).flatMap(build_history_message_output),
    has_more: response.has_more ?? false,
    next_cursor: next_cursor && next_cursor.length > 0 ? next_cursor : null,
  });
}

const slack_history_default_hours_back = 24 * 30;

function build_history_message_output(message: SlackHistoryMessage): Record<string, unknown>[] {
  const message_ts = message.ts;
  const text = message.text;
  const files = read_slack_channel_files(message.files);
  if (!message_ts || (!text && files.length === 0)) return [];
  return [
    {
      message_ts,
      time: to_iso_time(message_ts),
      user_id: message.user,
      text: text ?? '',
      thread_ts: message.thread_ts,
      files,
    },
  ];
}

function to_iso_time(message_ts: string): string | null {
  const seconds = Number.parseFloat(message_ts);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1_000).toISOString();
}

async function read_slack_file(
  input: NativeSlackInput,
  tool: SlackTool,
  connection: SlackConnection | null,
  token: string,
): Promise<RuntimeToolResult> {
  const team_id = connection?.external_account_id ?? connection?.provider_account?.team_id;
  if (!team_id) {
    return slack_error('slack_team_missing', 'Slack connection is missing its team ID.', {
      ...slack_metadata(tool, connection),
      node_key: input.node_key,
    });
  }

  try {
    const file_id = parse_external_slack_file_id(input.tool_input.file_id, team_id);
    const [source] = await create_slack_attachment_sources(token, team_id, [
      { external_file_id: file_id, file_access: 'check_file_info' },
    ]);
    if (!source) throw new Error(`Slack file ${file_id} is unavailable.`);
    const result = await runtime_read_attachment_tool.execute(
      { attachment_id: source.attachment_id },
      {
        db: input.db,
        workspace_id: input.workspace_id,
        session_id: input.session_id,
        run_id: input.run_id,
        actor_id: input.actor_id,
        ...(input.environment ? { environment: input.environment } : {}),
        attachment_sources: new Map([[source.attachment_id, source]]),
      },
    );
    if (!result.success) return result;
    return slack_success(input, tool, connection, result.data as Record<string, unknown>);
  } catch (error) {
    return slack_sdk_error(error, tool, connection);
  }
}

function parse_external_slack_file_id(value: string | undefined, team_id: string) {
  const file_id = require_slack_input_text(value, 'file_id');
  if (/^F[A-Z0-9]+$/u.test(file_id)) return file_id;
  const prefix = `slack:${team_id}:`;
  const external_file_id = file_id.startsWith(prefix) ? file_id.slice(prefix.length) : '';
  if (/^F[A-Z0-9]+$/u.test(external_file_id)) return external_file_id;
  throw new Error('Slack file_id does not belong to the connected workspace.');
}

async function join_slack_channel(
  input: NativeSlackInput,
  tool: SlackTool,
  connection: SlackConnection | null,
  token: string,
): Promise<RuntimeToolResult> {
  let response: SlackApiResponse;
  const channel_id = require_slack_input_text(input.tool_input.channel_id, 'channel_id');
  try {
    response = await create_slack_web_client(token).conversations.join({
      channel: channel_id,
    });
  } catch (error) {
    return slack_sdk_error(error, tool, connection);
  }
  if (response.ok === false) return slack_api_error(response, tool, connection);

  return slack_success(input, tool, connection, {
    channel_id,
    already_in_channel: response.already_in_channel ?? false,
    channel: response.channel ?? null,
  });
}

async function send_slack_message(
  input: NativeSlackInput,
  tool: SlackTool,
  connection: SlackConnection | null,
  token: string,
): Promise<RuntimeToolResult> {
  let response: SlackApiResponse;
  try {
    const message = {
      channel: require_slack_input_text(input.tool_input.channel_id, 'channel_id'),
      text: slack_message_text_from_markdown(
        require_slack_input_text(input.tool_input.message, 'message'),
      ),
      ...(Array.isArray(input.tool_input.blocks) ? { blocks: input.tool_input.blocks } : {}),
      ...(typeof input.tool_input.thread_ts === 'string'
        ? { thread_ts: input.tool_input.thread_ts }
        : {}),
      ...(typeof input.tool_input.reply_broadcast === 'boolean'
        ? { reply_broadcast: input.tool_input.reply_broadcast }
        : {}),
      unfurl_links: false,
      unfurl_media: false,
    } as Parameters<WebClient['chat']['postMessage']>[0];
    response = await create_slack_web_client(token).chat.postMessage(message);
  } catch (error) {
    return slack_sdk_error(error, tool, connection);
  }
  if (response.ok === false) return slack_api_error(response, tool, connection);

  return slack_success(input, tool, connection, {
    channel_id:
      (typeof response.channel === 'string' ? response.channel : undefined) ??
      input.tool_input.channel_id,
    message_id: response.ts ?? null,
    thread_ts: input.tool_input.thread_ts ?? response.ts ?? null,
    message: response.message ?? null,
  });
}

async function upload_slack_file(
  input: NativeSlackInput,
  tool: SlackTool,
  connection: SlackConnection | null,
  token: string,
): Promise<RuntimeToolResult> {
  const read_bytes = input.environment?.read_bytes;
  if (!read_bytes) {
    return slack_error('sandbox_unavailable', 'Slack file upload requires a runtime workspace.', {
      ...slack_metadata(tool, connection),
      node_key: input.node_key,
    });
  }

  const file_path = require_slack_input_text(input.tool_input.file_path, 'file_path');
  const filename = input.tool_input.filename ?? basename_for_workspace_path(file_path);
  const destination = resolve_slack_upload_destination(input);
  if (!destination.channel_id) {
    return slack_error(
      'slack_destination_missing',
      'Slack file upload needs channel_id unless the current turn came from a Slack channel or thread.',
      {
        ...slack_metadata(tool, connection),
        node_key: input.node_key,
        file_path,
      },
    );
  }

  let file_bytes: Uint8Array;
  try {
    file_bytes = await read_bytes(file_path);
  } catch (error) {
    return slack_error('file_read_failed', `Could not read ${file_path} from the workspace.`, {
      ...slack_metadata(tool, connection),
      file_path,
      file_read_error: format_error_message(error),
    });
  }

  if (filename.toLowerCase().endsWith('.xlsx')) {
    const uncalculated_error = check_xlsx_is_calculated(file_bytes, file_path, tool, connection);
    if (uncalculated_error) return uncalculated_error;
  }

  const durable_path = await copy_upload_to_durable_path(input, file_path, filename, file_bytes);

  const upload_channel = await resolve_slack_dm_channel_id(
    destination.channel_id,
    token,
    tool,
    connection,
  );
  if ('error' in upload_channel) return upload_channel.error;
  const upload_channel_id = upload_channel.channel_id;

  let response: SlackApiResponse;
  try {
    const upload = {
      channel_id: upload_channel_id,
      file: Buffer.from(file_bytes.buffer, file_bytes.byteOffset, file_bytes.byteLength),
      filename,
      ...(typeof input.tool_input.title === 'string' ? { title: input.tool_input.title } : {}),
      ...(typeof input.tool_input.initial_comment === 'string'
        ? { initial_comment: slack_message_text_from_markdown(input.tool_input.initial_comment) }
        : {}),
      ...(destination.thread_ts ? { thread_ts: destination.thread_ts } : {}),
      ...(typeof input.tool_input.alt_text === 'string'
        ? { alt_text: input.tool_input.alt_text }
        : {}),
    } as Parameters<WebClient['files']['uploadV2']>[0];
    response = await create_slack_web_client(token).files.uploadV2(upload);
  } catch (error) {
    return slack_sdk_error(error, tool, connection);
  }
  if (response.ok === false) return slack_api_error(response, tool, connection);

  return slack_success(input, tool, connection, {
    channel_id: upload_channel_id,
    thread_ts: destination.thread_ts ?? null,
    file_path,
    filename,
    ...(durable_path ? { durable_path } : {}),
    files: response.files ?? [],
  });
}

function is_durable_workspace_path(file_path: string) {
  const workspace_root = current_workspace_layout.model_root;
  const normalized_path = path.posix.normalize(file_path.replaceAll('\\', '/'));
  if (normalized_path.startsWith(`${workspace_root}/`)) {
    return workspace_path_is_durable(normalized_path.slice(workspace_root.length + 1));
  }
  if (normalized_path.startsWith('/')) return false;
  return workspace_path_is_durable(normalized_path);
}

async function copy_upload_to_durable_path(
  input: NativeSlackInput,
  file_path: string,
  filename: string,
  file_bytes: Uint8Array,
): Promise<string | null> {
  if (is_durable_workspace_path(file_path)) return null;

  const write_bytes = input.environment?.write_bytes;
  if (!write_bytes) return null;

  const durable_filename = basename_for_workspace_path(filename);
  const durable_relative_path = `files/${durable_filename}`;
  try {
    await write_bytes(durable_relative_path, bytes_to_stream(file_bytes));
    return `${current_workspace_layout.model_root}/${durable_relative_path}`;
  } catch (error) {
    log.warn('could not copy uploaded file into a durable workspace directory', {
      file_path,
      durable_relative_path,
      error: format_error_message(error),
    });
    return null;
  }
}

function bytes_to_stream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

// Excel recalculates formulas on open, but Slack's preview and Quick Look render the file
// as delivered — an .xlsx written without cached formula values shows as blank cells there,
// and a reader takes that as "the work wasn't done". Block the upload instead of trusting
// the agent to have run the recalculation step.
function check_xlsx_is_calculated(
  file_bytes: Uint8Array,
  file_path: string,
  tool: SlackTool,
  connection: SlackConnection | null,
): RuntimeToolResult | null {
  const offending_cells = find_uncalculated_formula_cells(file_bytes);
  if (offending_cells.length === 0) return null;

  const sample = offending_cells
    .slice(0, 5)
    .map((cell) => `${cell.sheet_path}!${cell.cell}`)
    .join(', ');
  return slack_error(
    'spreadsheet_not_calculated',
    `${file_path} has formula cells with no cached value (e.g. ${sample}), so Excel would ` +
      'recalculate them on open but Slack previews and Quick Look would show blank cells. ' +
      `Recalculate it first: run soffice --headless --convert-to xlsx --calc ${file_path} ` +
      '--outdir <dir>, then upload the LibreOffice-written copy from <dir> instead of this file.',
    {
      ...slack_metadata(tool, connection),
      file_path,
      uncalculated_cell_count: offending_cells.length,
      sample_uncalculated_cells: offending_cells.slice(0, 5),
    },
  );
}

// files.uploadV2 requires a real conversation id (C…/G…/D…). chat.postMessage happily opens a
// DM when handed a user id, but the upload API does not — so when the destination is a Slack
// user id we open (or reuse) the bot's DM with that user and upload into the DM channel instead.
async function resolve_slack_dm_channel_id(
  channel_id: string,
  token: string,
  tool: SlackTool,
  connection: SlackConnection | null,
): Promise<{ channel_id: string } | { error: RuntimeToolResult }> {
  if (!is_slack_user_id(channel_id)) return { channel_id };

  let response: SlackApiResponse;
  try {
    response = await create_slack_web_client(token).conversations.open({ users: channel_id });
  } catch (error) {
    return { error: slack_sdk_error(error, tool, connection) };
  }
  if (response.ok === false) return { error: slack_api_error(response, tool, connection) };

  const dm_channel_id =
    typeof response.channel === 'object' && response.channel !== null
      ? response.channel.id
      : undefined;
  if (!dm_channel_id) {
    return {
      error: slack_error(
        'slack_dm_unavailable',
        `Could not open a Slack DM for user ${channel_id}.`,
        {
          ...slack_metadata(tool, connection),
          slack_user_id: channel_id,
        },
      ),
    };
  }
  return { channel_id: dm_channel_id };
}

// Slack user ids start with U (member) or W (Enterprise Grid org user) followed by uppercase
// alphanumerics; conversation ids start with C (public), G (private/group), or D (DM). Match the
// full id shape, not just the first letter, so a channel name like "Updates" isn't read as a user.
function is_slack_user_id(id: string) {
  return /^[UW][A-Z0-9]{6,}$/.test(id);
}

function resolve_slack_upload_destination(input: NativeSlackInput) {
  const context = get_current_slack_context(input.source_context);
  const channel_id = input.tool_input.channel_id ?? context.channel_id;
  const inherits_context_thread = channel_id === context.channel_id;
  return {
    channel_id,
    thread_ts:
      input.tool_input.thread_ts ?? (inherits_context_thread ? context.thread_ts : undefined),
  };
}

function get_current_slack_context(source_context?: RuntimeToolSourceContext) {
  if (source_context?.source_type !== 'slack') return {};
  const slack = source_context.source_metadata?.slack;
  return {
    channel_id: slack?.channel_id,
    thread_ts: slack?.thread_ts,
  };
}

function slack_success(
  input: NativeSlackInput,
  tool: SlackTool,
  connection: SlackConnection | null,
  output: Record<string, unknown>,
): RuntimeToolResult {
  return {
    success: true,
    data: {
      node_key: input.node_key,
      app_name: tool.app_name,
      node_name: tool.node_name,
      output,
    },
    metadata: slack_metadata(tool, connection),
  };
}

function slack_api_error(
  response: SlackApiResponse,
  tool: SlackTool,
  connection: SlackConnection | null,
): RuntimeToolResult {
  const code = response.error ?? 'unknown';
  const remedy = slack_error_remedies[code];
  return slack_error(
    'slack_api_error',
    remedy ? `Slack API error: ${code}. ${remedy}` : `Slack API error: ${code}`,
    {
      ...slack_metadata(tool, connection),
      slack_error: response.error ?? null,
    },
  );
}

const slack_error_remedies: Record<string, string> = {
  thread_not_found:
    'That timestamp is not a thread parent in this channel. Read the channel without thread_ts and take the ts of the parent message, or accept that the thread is gone — do not send this call again.',
  not_in_channel:
    'This app is not a member of that channel, so its history is unreadable. Ask someone to invite the app, or work from a channel it has already joined.',
  channel_not_found:
    'No channel with that id is visible to this app. List channels to get a current id rather than reusing this one.',
};

function slack_sdk_error(
  error: unknown,
  tool: SlackTool,
  connection: SlackConnection | null,
): RuntimeToolResult {
  return slack_api_error(
    {
      ok: false,
      error: slack_sdk_error_code(error),
    },
    tool,
    connection,
  );
}

function slack_sdk_error_code(error: unknown) {
  if (!(error instanceof Error)) return 'unknown';
  const slack_error = error as SlackSdkError;
  if (slack_error.data?.error) return slack_error.data.error;
  if (slack_error.code) return slack_error.code;
  if (slack_error.message) return slack_error.message;
  return 'unknown';
}

function slack_error(code: string, message: string, metadata: Record<string, unknown>) {
  return {
    success: false as const,
    error: { code, message },
    metadata,
  };
}

function slack_metadata(tool: SlackTool, connection: SlackConnection | null) {
  return {
    source: 'native_slack',
    runtime_handler: tool.runtime_handler,
    node_id: tool.node_id,
    connection_id: connection?.connection_id ?? null,
  };
}

function require_slack_input_text(value: string | undefined, field: string) {
  if (value?.trim()) return value;
  throw new Error(`Slack ${field} is required.`);
}

function basename_for_workspace_path(file_path: string) {
  const basename = path.posix.basename(file_path.replaceAll('\\', '/'));
  return basename && basename !== '.' && basename !== '..' ? basename : 'upload';
}
