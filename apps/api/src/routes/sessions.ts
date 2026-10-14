import { randomUUID } from 'node:crypto';
import type { ApiEnv } from '@api/lib/context';
import { verify_proxy_secret } from '@api/lib/proxy_identity';
import { ok } from '@api/lib/response';
import { require_route_param } from '@api/lib/route_params';
import { parse_json_body, parse_json_text, validate_json, validate_query } from '@api/lib/validate';
import {
  read_session_or_raise,
  require_file_reader,
  require_run_reader,
  require_runtime_environment_reader,
  require_session_reader,
  require_tool_call_reader,
} from '@api/routes/sessions/session_reader';
import { start_session_browser } from '@api/services/session_browser';
import { create_chat_session } from '@api/services/sessions/create_chat_session';
import { delete_chat_session } from '@api/services/sessions/delete_chat_session';
import { list_chat_sessions } from '@api/services/sessions/list_chat_sessions';
import { send_session_message } from '@api/services/sessions/session_message_queue';
import {
  create_message_schema,
  parse_message_payload,
  type SessionMessageRequest,
} from '@api/services/sessions/session_message_request';
import { send_session_message_and_wait_for_run } from '@api/services/sessions/session_message_run_wait';
import { create_session_message_stream } from '@api/services/sessions/session_message_stream';
import { stop_session_run } from '@api/services/sessions/stop_session_run';
import {
  chat_session_update_schema,
  update_chat_session,
} from '@api/services/sessions/update_chat_session';
import { env } from '@coworker/config';
import { list_run_files } from '@coworker/core/db/queries/files';
import { list_page_pointed_tool_calls } from '@coworker/core/db/queries/pointed_tool_calls';
import {
  list_session_sandbox_url_previews,
  resolve_sandbox_url_preview_route,
} from '@coworker/core/db/queries/runtime_environments';
import { set_session_read_marker } from '@coworker/core/db/queries/session_read_markers';
import {
  get_session_message,
  list_session_message_page,
} from '@coworker/core/db/queries/session_read_pages';
import {
  get_run,
  get_runtime_environment,
  get_session,
  get_tool_call,
  list_run_events,
  list_run_messages,
  list_run_model_context_snapshots,
  list_run_tool_calls,
  list_session_runs,
  list_session_tool_calls,
  update_runtime_environment_state,
} from '@coworker/core/db/queries/sessions';
import {
  type ActivePreviewMetadata,
  E2bPreviewUnavailableError,
  find_active_preview,
  get_preview_launch_metadata,
  open_runtime_file,
  proxy_e2b_preview_request,
  read_context_snapshots,
  read_run_events,
  restart_e2b_preview,
  restore_run_message_tool_results,
  restore_tool_call_outputs,
  runtime_attachment_limits,
  with_active_preview_metadata,
  without_active_preview_ports,
} from '@coworker/runtime-platform';
import { format_error_message, NotFoundError, ValidationError } from '@coworker/shared';
import { zValidator } from '@hono/zod-validator';
import { list_public_run_chat_events } from '@runtime-platform/chat_stream/live_run_events';
import { public_run, public_run_event } from '@runtime-platform/chat_stream/public_run_output';
import {
  public_session_message,
  public_tool_call,
  redact_skill_tool_call,
} from '@runtime-platform/chat_stream/public_session_reads';
import { run_message_v2_shape } from '@runtime-platform/tools/tool_result_message_content';
import { type Context, Hono } from 'hono';
import { z } from 'zod';

const create_session_schema = z.object({
  session_title: z.string().min(1).max(160).optional(),
  project_id: z.string().min(1).optional(),
});

const list_sessions_query_schema = z.object({
  project_id: z.string().min(1).optional(),
});

const mark_read_schema = z.object({
  last_read_sequence: z.number().int().nonnegative(),
});

const validate_message_request = zValidator('json', create_message_schema, (result) => {
  if (result.success) return;
  throw new ValidationError('Request body failed validation', z.flattenError(result.error));
});

export const session_routes = new Hono<ApiEnv>()
  .all('/internal/sandbox-preview-proxy', proxy_hostname_preview_request)
  .all('/internal/sandbox-preview-proxy/*', proxy_hostname_preview_request)
  .use('/v1/sessions/:session_id', require_session_reader)
  .use('/v1/sessions/:session_id/*', require_session_reader)
  .use('/v1/runs/:run_id', require_run_reader)
  .use('/v1/runs/:run_id/*', require_run_reader)
  .use('/v1/files/:file_id/content', require_file_reader)
  .use('/v1/artifacts/:file_id/content', require_file_reader)
  .use('/v1/runtime-environments/:runtime_environment_id/*', require_runtime_environment_reader)
  .use('/v1/tool-calls/:tool_call_id', require_tool_call_reader)
  .get('/v1/sessions', validate_query(list_sessions_query_schema), async (c) => {
    const sessions = await list_chat_sessions(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      user_id: c.get('user_id'),
      project_id: c.req.valid('query').project_id,
    });
    return c.json(ok(sessions));
  })
  .post('/v1/sessions', validate_json(create_session_schema), async (c) => {
    const body = c.req.valid('json');
    const session = await create_chat_session(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      agent_id: c.get('agent_id'),
      user_id: c.get('user_id'),
      ...(body.project_id ? { project_id: body.project_id } : {}),
      ...(body.session_title ? { session_title: body.session_title } : {}),
    });
    return c.json(ok(session), 201);
  })
  .patch('/v1/sessions/:session_id', validate_json(chat_session_update_schema), async (c) => {
    const updated = await update_chat_session(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      user_id: c.get('user_id'),
      before: await read_session_or_raise(c, require_route_param(c, 'session_id')),
      update: c.req.valid('json'),
    });
    return c.json(ok(updated));
  })
  .get('/v1/sessions/:session_id', async (c) => {
    const session = await get_session(
      c.get('db'),
      c.get('workspace_id'),
      c.req.param('session_id'),
    );
    if (!session) throw new NotFoundError('Session');

    return c.json(ok(session));
  })
  .delete('/v1/sessions/:session_id', async (c) => {
    const session = await get_session(
      c.get('db'),
      c.get('workspace_id'),
      c.req.param('session_id'),
    );
    if (!session) throw new NotFoundError('Session');

    const archived = await delete_chat_session(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      user_id: c.get('user_id'),
      chat: session,
    });
    return c.json(ok(archived));
  })
  .post('/v1/sessions/:session_id/read', validate_json(mark_read_schema), async (c) => {
    const session_id = c.req.param('session_id');
    const last_read_sequence = await set_session_read_marker(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      session_id,
      reader_id: c.get('user_id'),
      last_read_sequence: c.req.valid('json').last_read_sequence,
    });
    return c.json(ok({ session_id, last_read_sequence: last_read_sequence ?? null }));
  })
  .get('/v1/sessions/:session_id/sandbox-previews', async (c) => {
    const previews = await list_session_sandbox_url_previews(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      session_id: c.req.param('session_id'),
      options: sandbox_preview_options(),
    });
    if (!previews) throw new NotFoundError('Session');

    return c.json(ok(previews));
  })
  .post('/v1/sessions/:session_id/browser/start', async (c) => {
    const preview = await start_session_browser(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      session_id: c.req.param('session_id'),
      actor_id: c.get('user_id'),
      options: sandbox_preview_options(),
    });
    return c.json(ok(preview));
  })
  .post('/v1/sessions/:session_id/messages', validate_message_request, async (c) => {
    const run = await send_message_and_wait_for_run(c, c.req.valid('json'));
    return c.json(ok(public_run(run)), 201);
  })
  .post('/v1/sessions/:session_id/messages/stream', async (c) => {
    const { body, multipart_files } = await read_stream_message_request(c);
    const scope = read_message_scope(c);
    const { job } = await send_session_message(c.get('db'), {
      ...scope,
      client_message_id: `api:${randomUUID()}`,
      body,
      multipart_files,
    });
    return new Response(
      create_session_message_stream(
        c.get('db'),
        { ...scope, job_id: job.job_id },
        c.req.raw.signal,
      ),
      {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        },
      },
    );
  })
  .post('/v1/sessions/:session_id/runs', validate_message_request, async (c) => {
    const run = await send_message_and_wait_for_run(c, c.req.valid('json'));
    return c.json(ok(public_run(run)), 201);
  })
  .get('/v1/sessions/:session_id/messages', async (c) => {
    const db = c.get('db');
    const workspace_id = c.get('workspace_id');
    const page_input = {
      workspace_id,
      session_id: c.req.param('session_id'),
      ...query_before_sequence(c.req.query('before_sequence')),
      ...query_page_limit(c.req.query('limit')),
    };
    const [page, tool_call_rows] = await Promise.all([
      list_session_message_page(db, page_input),
      list_page_pointed_tool_calls(db, { ...page_input, pointer_shape: run_message_v2_shape }),
    ]);
    const items = await restore_run_message_tool_results(db, {
      workspace_id,
      rows: page.items,
      reading: 'use_preview',
      tool_call_rows,
    });
    return c.json(ok({ items: items.map(public_session_message), next_cursor: page.next_cursor }));
  })
  .get('/v1/sessions/:session_id/messages/:run_message_id', async (c) => {
    const db = c.get('db');
    const workspace_id = c.get('workspace_id');
    const message = await get_session_message(db, {
      workspace_id,
      session_id: c.req.param('session_id'),
      run_message_id: c.req.param('run_message_id'),
    });
    if (!message) throw new NotFoundError('Message');
    const [restored] = await restore_run_message_tool_results(db, {
      workspace_id,
      rows: [message],
      reading: 'load_full_value',
    });
    return c.json(ok(restored));
  })
  .get('/v1/sessions/:session_id/runs', async (c) => {
    const runs = await list_session_runs(
      c.get('db'),
      c.get('workspace_id'),
      c.req.param('session_id'),
    );
    return c.json(ok(runs.map(public_run)));
  })
  .get('/v1/sessions/:session_id/tool-calls', async (c) => {
    const db = c.get('db');
    const workspace_id = c.get('workspace_id');
    const tool_calls = await restore_tool_call_outputs(db, {
      workspace_id,
      rows: await list_session_tool_calls(db, workspace_id, c.req.param('session_id')),
      reading: 'use_preview',
    });
    return c.json(ok(tool_calls.map(public_tool_call)));
  })
  .get('/v1/runs/:run_id', async (c) => {
    const run = await get_run(c.get('db'), c.get('workspace_id'), c.req.param('run_id'));
    if (!run) throw new NotFoundError('Run');

    return c.json(ok(public_run(run)));
  })
  .get('/v1/runs/:run_id/inspect', async (c) => {
    const db = c.get('db');
    const workspace_id = c.get('workspace_id');
    const run_id = c.req.param('run_id');
    const run = await get_run(db, workspace_id, run_id);
    if (!run) throw new NotFoundError('Run');

    const reading = 'use_preview' as const;
    const [messages, events, tool_calls, model_context_snapshots, files] = await Promise.all([
      list_run_messages(db, workspace_id, run_id).then((rows) =>
        restore_run_message_tool_results(db, { workspace_id, rows, reading }),
      ),
      list_run_events(db, workspace_id, run_id).then((rows) =>
        read_run_events(db, { workspace_id, rows, payload_reading: 'load_full_value' }),
      ),
      list_run_tool_calls(db, workspace_id, run_id).then((rows) =>
        restore_tool_call_outputs(db, { workspace_id, rows, reading }),
      ),
      list_run_model_context_snapshots(db, workspace_id, run_id).then((rows) =>
        read_context_snapshots(db, { workspace_id, rows }),
      ),
      list_run_files(db, workspace_id, run_id),
    ]);

    return c.json(
      ok({
        run: public_run(run),
        messages: messages.map(public_session_message),
        events: events.map(public_run_event),
        tool_calls: tool_calls.map((tool_call) => ({
          ...public_tool_call(tool_call),
          risk_class: tool_call.risk_class,
          approval_mode: tool_call.approval_mode,
          error_code: tool_call.error_code,
          finished_time: tool_call.finished_time,
        })),
        model_context_snapshots,
        files: files.map(with_pre_rename_file_keys),
        artifacts: files.map(with_pre_rename_file_keys),
        audit: build_run_audit({ tool_calls, model_context_snapshots }),
      }),
    );
  })
  .get('/v1/runs/:run_id/events', async (c) => {
    const db = c.get('db');
    const workspace_id = c.get('workspace_id');
    const tool_call_id = c.req.query('tool_call_id');
    const rows = await list_run_events(db, workspace_id, c.req.param('run_id'), {
      ...(tool_call_id ? { tool_call_id } : {}),
    });
    const events = await read_run_events(db, {
      workspace_id,
      rows,
      payload_reading: 'load_full_value',
    });
    return c.json(ok(events.map(public_run_event)));
  })
  .get('/v1/runs/:run_id/chat-stream-events', async (c) => {
    const db = c.get('db');
    const workspace_id = c.get('workspace_id');
    const run_id = c.req.param('run_id');
    const events = await list_public_run_chat_events(db, {
      workspace_id,
      run_id,
      ...query_after_sequence(c.req.query('after_sequence')),
      ...query_page_limit(c.req.query('limit')),
    });
    return c.json(ok(events));
  })
  .post('/v1/runs/:run_id/cancel', async (c) => {
    const run = await stop_session_run(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      run_id: c.req.param('run_id'),
      actor_id: c.get('user_id'),
    });
    return c.json(ok(public_run(run)));
  })
  .get('/v1/runs/:run_id/tool-calls', async (c) => {
    const db = c.get('db');
    const workspace_id = c.get('workspace_id');
    const tool_calls = await restore_tool_call_outputs(db, {
      workspace_id,
      rows: await list_run_tool_calls(db, workspace_id, c.req.param('run_id')),
      reading: 'use_preview',
    });
    return c.json(ok(tool_calls.map(public_tool_call)));
  })
  .get('/v1/runs/:run_id/files', list_run_files_route)
  .get('/v1/runs/:run_id/artifacts', list_run_files_route)
  .get('/v1/files/:file_id/content', read_file_content_route)
  .get('/v1/artifacts/:file_id/content', read_file_content_route)
  .all('/v1/runtime-environments/:runtime_environment_id/preview/:port', proxy_preview_request)
  .all('/v1/runtime-environments/:runtime_environment_id/preview/:port/*', proxy_preview_request)
  .get('/v1/tool-calls/:tool_call_id', async (c) => {
    const db = c.get('db');
    const workspace_id = c.get('workspace_id');
    const stored_call = await get_tool_call(db, workspace_id, c.req.param('tool_call_id'));
    if (!stored_call) throw new NotFoundError('Tool call');
    const [tool_call] = await restore_tool_call_outputs(db, {
      workspace_id,
      rows: [stored_call],
      reading: 'load_full_value',
    });
    if (!tool_call) throw new NotFoundError('Tool call');

    return c.json(ok(redact_skill_tool_call(tool_call)));
  });

async function proxy_preview_request(c: Context<ApiEnv>) {
  const runtime_environment_id = require_route_param(c, 'runtime_environment_id');
  const port = preview_port_from_param(require_route_param(c, 'port'));
  return proxy_runtime_environment_preview_request(c, {
    runtime_environment_id,
    port,
    workspace_id: c.get('workspace_id'),
    actor_id: c.get('user_id'),
    path: preview_request_path(c.req.path, runtime_environment_id, port),
    public_base_url: preview_public_base_url(c.req.url, runtime_environment_id, port),
    require_active_preview: true,
  });
}

async function proxy_hostname_preview_request(c: Context<ApiEnv>) {
  verify_proxy_secret(c);
  const preview_host = c.req.header('x-coworker-preview-host');
  if (!preview_host) throw new ValidationError('Missing preview host.');

  const route = await resolve_sandbox_url_preview_route(c.get('db'), {
    preview_host,
    options: sandbox_preview_options(),
  });
  if (!route) throw new NotFoundError('Sandbox preview');

  return proxy_runtime_environment_preview_request(c, {
    runtime_environment_id: route.runtime_environment_id,
    workspace_id: route.workspace_id,
    actor_id: 'system',
    port: route.port,
    path: hostname_preview_request_path(c.req.path),
    public_base_url: route.preview_url,
    require_active_preview: false,
  });
}

async function proxy_runtime_environment_preview_request(
  c: Context<ApiEnv>,
  input: {
    runtime_environment_id: string;
    workspace_id: string;
    actor_id: string;
    port: number;
    path: string;
    public_base_url: string;
    require_active_preview: boolean;
  },
) {
  const runtime_environment = await get_runtime_environment(c.get('db'), {
    workspace_id: input.workspace_id,
    runtime_environment_id: input.runtime_environment_id,
  });
  if (!runtime_environment) throw new NotFoundError('Runtime environment');
  if (runtime_environment.environment_provider !== 'e2b') {
    throw new ValidationError('Preview proxy only supports E2B runtime environments.');
  }
  if (!runtime_environment.provider_environment_id) throw new NotFoundError('Preview sandbox');
  const active_preview = find_active_preview(runtime_environment.environment_metadata, input.port);
  if (!active_preview && input.require_active_preview) throw new NotFoundError('Preview port');

  const proxy_input = {
    provider_sandbox_id: runtime_environment.provider_environment_id,
    port: input.port,
    path: input.path,
    search: new URL(c.req.url).search,
    request: c.req.raw,
    public_base_url: input.public_base_url,
  };

  try {
    return await proxy_e2b_preview_request(proxy_input);
  } catch (error) {
    if (!active_preview) {
      if (error instanceof E2bPreviewUnavailableError) throw new NotFoundError('Preview server');
      throw error;
    }

    return restart_preview_and_proxy(c, {
      error,
      runtime_environment,
      active_preview,
      actor_id: input.actor_id,
      port: input.port,
      public_base_url: input.public_base_url,
      proxy_input,
    });
  }
}

type RuntimeEnvironmentRecord = NonNullable<Awaited<ReturnType<typeof get_runtime_environment>>>;
type ProxyPreviewInput = Parameters<typeof proxy_e2b_preview_request>[0];

async function restart_preview_and_proxy(
  c: Context<ApiEnv>,
  input: {
    error: unknown;
    runtime_environment: RuntimeEnvironmentRecord;
    active_preview: ActivePreviewMetadata;
    actor_id: string;
    port: number;
    public_base_url: string;
    proxy_input: ProxyPreviewInput;
  },
) {
  if (!(input.error instanceof E2bPreviewUnavailableError)) throw input.error;

  const launch_metadata = get_preview_launch_metadata(input.active_preview);
  if (!launch_metadata) {
    await clear_preview_port_metadata(c, {
      runtime_environment: input.runtime_environment,
      actor_id: input.actor_id,
      port: input.port,
      error_message: input.error.message,
    });
    throw new NotFoundError('Preview server');
  }

  try {
    const restarted_preview = await restart_e2b_preview({
      provider_sandbox_id: String(input.runtime_environment.provider_environment_id),
      port: input.port,
      command: launch_metadata.command,
      args: launch_metadata.args,
      ...(launch_metadata.cwd === undefined ? {} : { cwd: launch_metadata.cwd }),
      ...(launch_metadata.ready_path === undefined
        ? {}
        : { ready_path: launch_metadata.ready_path }),
      timeout_ms: 30_000,
    });
    await update_runtime_environment_state(c.get('db'), {
      runtime_environment_id: input.runtime_environment.runtime_environment_id,
      environment_status: 'running',
      environment_metadata: with_active_preview_metadata(
        input.runtime_environment.environment_metadata,
        {
          ...input.active_preview,
          port: input.port,
          preview_url: input.public_base_url,
          process_id: restarted_preview.process_id ?? null,
          command: restarted_preview.command,
          launch_command: launch_metadata.command,
          launch_args: launch_metadata.args,
          cwd: restarted_preview.cwd,
          ready_path: launch_metadata.ready_path ?? '/',
          started_time: new Date().toISOString(),
          restarted_time: new Date().toISOString(),
        },
      ),
      actor_id: input.actor_id,
    });

    return await proxy_e2b_preview_request(input.proxy_input);
  } catch (error) {
    await clear_preview_port_metadata(c, {
      runtime_environment: input.runtime_environment,
      actor_id: input.actor_id,
      port: input.port,
      error_message: format_error_message(error),
    });
    throw new NotFoundError('Preview server');
  }
}

async function clear_preview_port_metadata(
  c: Context<ApiEnv>,
  input: {
    runtime_environment: RuntimeEnvironmentRecord;
    actor_id: string;
    port: number;
    error_message: string;
  },
) {
  await update_runtime_environment_state(c.get('db'), {
    runtime_environment_id: input.runtime_environment.runtime_environment_id,
    environment_status: input.runtime_environment.environment_status,
    environment_metadata: without_active_preview_ports(
      input.runtime_environment.environment_metadata,
      [input.port],
      {
        last_preview_error_message: input.error_message,
        last_preview_stopped_time: new Date().toISOString(),
      },
    ),
    actor_id: input.actor_id,
  });
}
function preview_port_from_param(raw_port: string) {
  const port = Number.parseInt(raw_port, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new ValidationError('Invalid preview port.');
  }
  return port;
}

function preview_request_path(request_path: string, runtime_environment_id: string, port: number) {
  const prefix = `/v1/runtime-environments/${runtime_environment_id}/preview/${port}`;
  const preview_path = request_path.slice(prefix.length);
  if (!preview_path) return '/';
  return preview_path.startsWith('/') ? preview_path : `/${preview_path}`;
}

function hostname_preview_request_path(request_path: string) {
  const prefix = '/internal/sandbox-preview-proxy';
  const preview_path = request_path.slice(prefix.length);
  if (!preview_path) return '/';
  return preview_path.startsWith('/') ? preview_path : `/${preview_path}`;
}

function preview_public_base_url(
  request_url: string,
  runtime_environment_id: string,
  port: number,
) {
  const url = new URL(request_url);
  url.pathname = `/v1/runtime-environments/${runtime_environment_id}/preview/${port}`;
  url.search = '';
  return url.toString().replace(/\/$/u, '');
}

function sandbox_preview_options() {
  return {
    preview_base_domain: env.SANDBOX_PREVIEW_BASE_DOMAIN,
    preview_protocol: env.SANDBOX_PREVIEW_PROTOCOL,
    default_port: env.SANDBOX_PREVIEW_DEFAULT_PORT,
    use_provider_host: env.ENVIRONMENT !== 'production',
  };
}

function query_after_sequence(value: string | undefined) {
  if (value === undefined || value.trim() === '') return {};

  const after_sequence = Number(value);
  if (!Number.isInteger(after_sequence) || after_sequence < 0) {
    throw new ValidationError('after_sequence must be a non-negative integer');
  }

  return { after_sequence };
}

function query_before_sequence(value: string | undefined) {
  if (value === undefined || value.trim() === '') return {};

  const before_sequence = Number(value);
  if (!Number.isInteger(before_sequence) || before_sequence < 0) {
    throw new ValidationError('before_sequence must be a non-negative integer');
  }

  return { before_sequence };
}

function query_page_limit(value: string | undefined) {
  if (value === undefined || value.trim() === '') return {};

  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new ValidationError('limit must be a positive integer');
  }

  return { limit };
}

function read_message_scope(c: Context<ApiEnv>) {
  return {
    workspace_id: c.get('workspace_id'),
    session_id: require_route_param(c, 'session_id'),
    user_id: c.get('user_id'),
  };
}

function send_message_and_wait_for_run(c: Context<ApiEnv>, body: SessionMessageRequest) {
  return send_session_message_and_wait_for_run(c.get('db'), {
    ...read_message_scope(c),
    body,
    signal: c.req.raw.signal,
  });
}

async function list_run_files_route(c: Context<ApiEnv, '/v1/runs/:run_id/files'>) {
  const files = await list_run_files(c.get('db'), c.get('workspace_id'), c.req.param('run_id'));
  return c.json(ok(files.map(with_pre_rename_file_keys)));
}

function with_pre_rename_file_keys<
  T extends { file_id: string; file_status: string; file_purpose: string },
>(file: T) {
  return {
    ...file,
    artifact_id: file.file_id,
    artifact_status: file.file_status,
    artifact_kind: file.file_purpose,
  };
}

async function read_file_content_route(c: Context<ApiEnv, '/v1/files/:file_id/content'>) {
  const opened_file = await open_runtime_file(c.get('db'), {
    workspace_id: c.get('workspace_id'),
    file_id: c.req.param('file_id'),
    actor_id: c.get('user_id'),
  });
  if (opened_file.missing) throw new NotFoundError('File bytes');

  return c.json(
    ok({
      file: opened_file.file,
      artifact: opened_file.file,
      content_text: opened_file.content_text,
      byte_size: opened_file.byte_size,
      checksum_sha256: opened_file.checksum_sha256,
    }),
  );
}

// Reads either a JSON request — whose file parts name already-uploaded files — or a
// multipart request carrying the bytes inline. Multipart stays for API clients that post
// straight to the API; the dashboard cannot use it, because its bytes would have to cross a
async function read_stream_message_request(c: Context<ApiEnv>) {
  const content_type = c.req.header('content-type') ?? '';
  if (!content_type.startsWith('multipart/form-data')) {
    const body = parse_message_payload(await parse_json_body(c, z.unknown()));
    return { body, multipart_files: new Map<string, File>() };
  }
  const content_length = Number(c.req.header('content-length'));
  if (
    Number.isFinite(content_length) &&
    content_length > runtime_attachment_limits.max_request_bytes + 1024 * 1024
  ) {
    throw new ValidationError('Multipart message exceeds the 25 MiB attachment limit');
  }
  const form = await c.req.formData();
  const payload = form.get('payload');
  if (typeof payload !== 'string') throw new ValidationError('Multipart payload is required');
  const body = parse_message_payload(parse_json_text(payload, z.unknown()));
  const attachment_ids = form.getAll('attachment_id');
  const files = form.getAll('attachment');
  if (attachment_ids.length !== files.length) {
    throw new ValidationError('Each binary attachment requires one attachment id');
  }

  const declared_files = new Map(
    (body.content ?? []).flatMap((part) =>
      part.type === 'file' && part.file_id && !part.text ? [[part.file_id, part] as const] : [],
    ),
  );
  const multipart_files = new Map(
    files.map((value, index) =>
      read_declared_multipart_file(value, attachment_ids[index], declared_files),
    ),
  );
  if (multipart_files.size !== files.length) {
    throw new ValidationError('Each binary attachment needs its own attachment id');
  }
  if (multipart_files.size > runtime_attachment_limits.max_attachments) {
    throw new ValidationError(
      `A message carries at most ${runtime_attachment_limits.max_attachments} attachments`,
    );
  }
  return { body, multipart_files };
}

function read_declared_multipart_file(
  value: string | File,
  attachment_id: string | File | undefined,
  declared_files: Map<string, { name?: string | undefined; mime_type?: string | undefined }>,
): [string, File] {
  if (typeof value === 'string' || typeof attachment_id !== 'string') {
    throw new ValidationError('Multipart attachment fields are invalid');
  }
  const declared = declared_files.get(attachment_id);
  const mime_type = value.type || 'application/octet-stream';
  if (!declared || declared.name !== value.name || declared.mime_type !== mime_type) {
    throw new ValidationError(`Multipart attachment ${attachment_id} does not match its file part`);
  }
  if (value.size > runtime_attachment_limits.max_attachment_bytes) {
    throw new ValidationError(`Multipart attachment ${attachment_id} exceeds the attachment limit`);
  }
  return [attachment_id, value];
}

function build_run_audit(input: {
  tool_calls: Array<{
    tool_call_id: string;
    tool_status: string;
    output_data: unknown;
    error_message: string | null;
  }>;
  model_context_snapshots: unknown[];
}) {
  const unfinished_tool_calls = input.tool_calls.filter(
    (tool_call) =>
      !['completed', 'failed', 'blocked', 'timed_out', 'cancelled'].includes(tool_call.tool_status),
  );

  return {
    has_model_context_snapshot: input.model_context_snapshots.length > 0,
    unfinished_tool_call_count: unfinished_tool_calls.length,
    unfinished_tool_call_ids: unfinished_tool_calls.map((tool_call) => tool_call.tool_call_id),
    failed_tool_call_count: input.tool_calls.filter((tool_call) => tool_call.error_message).length,
  };
}
