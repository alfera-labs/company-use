import type { ApiEnv } from '@api/lib/context';
import { get_file } from '@coworker/core/db/queries/files';
import { find_visible_project } from '@coworker/core/db/queries/project_visibility';
import { get_run_for_user } from '@coworker/core/db/queries/run_for_user';
import {
  get_runtime_environment,
  get_session_for_user,
  get_tool_call,
} from '@coworker/core/db/queries/sessions';
import { NotFoundError } from '@coworker/shared';
import type { Context, MiddlewareHandler, Next } from 'hono';

export const require_session_reader: MiddlewareHandler<ApiEnv> = async (c, next) => {
  const session_id = c.req.param('session_id') ?? '';
  if (c.get('readable_session_id') === session_id) return next();
  c.set('readable_session_id', session_id);
  return continue_after_access_check(c, read_session_or_raise(c, session_id), next);
};

async function continue_after_access_check(
  c: Context<ApiEnv>,
  access_check: Promise<unknown>,
  next: Next,
) {
  if (is_read_only_request(c)) return read_beside_access_check(c, access_check, next);
  await access_check;
  await next();
}

function is_read_only_request(c: Context<ApiEnv>) {
  return c.req.method === 'GET' || c.req.method === 'HEAD';
}

async function read_beside_access_check(
  c: Context<ApiEnv>,
  access_check: Promise<unknown>,
  next: Next,
) {
  const [access, read] = await Promise.allSettled([access_check, next()]);
  if (access.status === 'rejected') {
    await c.res.body?.cancel();
    throw access.reason;
  }
  if (read.status === 'rejected') throw read.reason;
}

export const require_run_reader: MiddlewareHandler<ApiEnv> = async (c, next) =>
  continue_after_access_check(c, read_run_or_raise(c, c.req.param('run_id') ?? ''), next);

export const require_file_reader: MiddlewareHandler<ApiEnv> = async (c, next) => {
  await read_file_or_raise(c, c.req.param('file_id') ?? '');
  await next();
};

export const require_tool_call_reader: MiddlewareHandler<ApiEnv> = async (c, next) => {
  const tool_call = await get_tool_call(
    c.get('db'),
    c.get('workspace_id'),
    c.req.param('tool_call_id') ?? '',
  );
  if (!tool_call) throw new NotFoundError('Tool call');
  await read_session_or_raise(c, tool_call.session_id);
  await next();
};

export const require_runtime_environment_reader: MiddlewareHandler<ApiEnv> = async (c, next) => {
  const runtime_environment = await get_runtime_environment(c.get('db'), {
    workspace_id: c.get('workspace_id'),
    runtime_environment_id: c.req.param('runtime_environment_id') ?? '',
  });
  if (!runtime_environment) throw new NotFoundError('Runtime environment');
  if (runtime_environment.session_id) {
    await read_session_or_raise(c, runtime_environment.session_id);
  }
  await next();
};

export async function read_session_or_raise(c: Context<ApiEnv>, session_id: string) {
  const session = await get_session_for_user(c.get('db'), {
    workspace_id: c.get('workspace_id'),
    session_id,
    user_id: c.get('user_id'),
  });
  if (!session) throw new NotFoundError('Session');
  return session;
}

export async function read_run_or_raise(c: Context<ApiEnv>, run_id: string) {
  const run = await get_run_for_user(c.get('db'), {
    workspace_id: c.get('workspace_id'),
    run_id,
    user_id: c.get('user_id'),
  });
  if (!run) throw new NotFoundError('Run');
  return run;
}

export async function read_file_or_raise(c: Context<ApiEnv>, file_id: string) {
  const file = await get_file(c.get('db'), c.get('workspace_id'), file_id);
  if (!file) throw new NotFoundError('File');

  if (file.session_id) await read_session_or_raise(c, file.session_id);
  else if (file.run_id) await read_run_or_raise(c, file.run_id);
  else if (file.project_id) {
    const project = await find_visible_project(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      project_id: file.project_id,
      user_id: c.get('user_id'),
    });
    if (!project) throw new NotFoundError('File');
  }

  return file;
}
