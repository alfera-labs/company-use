import { randomUUID } from 'node:crypto';
import { agent_browser_binary } from '@agent-core/browser/agent_browser_command';
import type { SessionEnv } from '@agent-core/environment';
import { env } from '@coworker/config';
import type { Database } from '@coworker/core';
import {
  list_session_sandbox_url_previews,
  type SandboxUrlPreview,
  type SandboxUrlPreviewOptions,
} from '@coworker/core/db/queries/runtime_environments';
import {
  get_runtime_environment,
  get_session,
  update_runtime_environment_state,
  update_session_runtime_environment,
} from '@coworker/core/db/queries/sessions';
import { AppError, ConflictError, format_error_message, NotFoundError } from '@coworker/shared';
import { create_browser_state_config } from '@runtime-platform/browser/browser_state_config';
import {
  connect_e2b_session_env,
  set_e2b_sandbox_idle_timeout,
} from '@runtime-platform/orchestrator/e2b_sandbox_client';
import { acquire_session_lock } from '@runtime-platform/orchestrator/session_locker';
import {
  mark_coding_workspace_failed,
  open_or_create_coding_workspace,
} from '@runtime-platform/orchestrator/workspace_runtime';
import { read_volume_id } from '@runtime-platform/storage/volume_metadata';
import { volume_sandbox_lifetime_ms } from '@runtime-platform/storage/volume_runtime';
import { open_browser_live_view } from '@runtime-platform/tools/browser_live_view';

// Requests share startup inside one API instance; the session lease protects cold boots across instances.
const pending_browser_starts = new Map<string, Promise<SandboxUrlPreview>>();

type StartSessionBrowserInput = {
  workspace_id: string;
  session_id: string;
  actor_id: string;
  options: SandboxUrlPreviewOptions;
};

export function start_session_browser(db: Database, input: StartSessionBrowserInput) {
  const key = `${input.workspace_id}:${input.session_id}`;
  const pending = pending_browser_starts.get(key);
  if (pending) return pending;
  const starting = open_session_browser(db, input).finally(() =>
    pending_browser_starts.delete(key),
  );
  pending_browser_starts.set(key, starting);
  return starting;
}

async function open_session_browser(db: Database, input: StartSessionBrowserInput) {
  const session = await get_session(db, input.workspace_id, input.session_id);
  if (!session) throw new NotFoundError('Session');
  if (env.COWORKER_WORKSPACE_RUNTIME_PROVIDER !== 'e2b') {
    throw new AppError('browser_unavailable', 'The sandbox here has no browser to show.', 503);
  }
  const running_environment = session.runtime_environment_id
    ? await get_runtime_environment(db, {
        workspace_id: input.workspace_id,
        runtime_environment_id: session.runtime_environment_id,
      })
    : null;
  if (
    running_environment?.environment_status === 'running' &&
    running_environment.provider_environment_id
  ) {
    const volume_id = read_volume_id(running_environment.environment_metadata);
    const connected = await connect_e2b_session_env({
      runtime_environment_id: running_environment.runtime_environment_id,
      sandbox_id: running_environment.provider_environment_id,
      workspace_mount_key: running_environment.workspace_mount_key ?? input.session_id,
      run_id: session.active_run_id ?? input.session_id,
      agent_id: session.agent_id,
      host_workspace_root: running_environment.root_path,
      workspace_directories: [],
      ...(session.locked_by_run_id ? { timeout_ms: volume_sandbox_lifetime_ms } : {}),
      ...(volume_id ? { command_env: create_browser_state_config({ volume_id }).command_env } : {}),
    });
    if (connected)
      return start_browser_preview(
        db,
        input,
        running_environment.runtime_environment_id,
        connected,
      );
  }
  if (session.locked_by_run_id) {
    throw new ConflictError('The chat environment is starting. Retry the browser shortly.');
  }
  return boot_session_browser(db, input, session.agent_id);
}

async function boot_session_browser(
  db: Database,
  input: StartSessionBrowserInput,
  agent_id: string,
) {
  const operation_id = `browser_${randomUUID()}`;
  const lock = await acquire_session_lock(db, { ...input, run_id: operation_id });
  let workspace: Awaited<ReturnType<typeof open_or_create_coding_workspace>> | undefined;
  try {
    workspace = await open_or_create_coding_workspace(db, {
      ...input,
      agent_id,
      run_id: operation_id,
      provider: 'e2b',
    });
    await update_session_runtime_environment(db, {
      session_id: input.session_id,
      runtime_environment_id: workspace.runtime_environment_id,
      actor_id: input.actor_id,
    });
    await update_runtime_environment_state(db, {
      runtime_environment_id: workspace.runtime_environment_id,
      environment_status: 'running',
      merge_environment_metadata: { browser_started: true },
      actor_id: input.actor_id,
    });
    const preview = await start_browser_preview(
      db,
      input,
      workspace.runtime_environment_id,
      workspace.environment,
    );
    await set_e2b_sandbox_idle_timeout(String(workspace.environment.metadata?.provider_sandbox_id));
    return preview;
  } catch (error) {
    if (workspace) {
      await mark_coding_workspace_failed(db, {
        workspace_id: input.workspace_id,
        runtime_environment_id: workspace.runtime_environment_id,
        close_token: workspace.close_token,
        actor_id: input.actor_id,
        error_message: format_error_message(error),
      });
      await update_runtime_environment_state(db, {
        runtime_environment_id: workspace.runtime_environment_id,
        environment_status: 'failed',
        merge_environment_metadata: { browser_started: false },
        actor_id: input.actor_id,
      });
    }
    throw error;
  } finally {
    await lock.release('active');
  }
}

async function start_browser_preview(
  db: Database,
  input: StartSessionBrowserInput,
  runtime_environment_id: string,
  environment: SessionEnv,
): Promise<SandboxUrlPreview> {
  const browser = await environment.exec?.({
    command: agent_browser_binary,
    args: ['get', 'url'],
    timeout_ms: 30_000,
  });
  if (!browser || browser.exit_code !== 0) {
    throw new AppError('browser_start_failed', 'The browser could not start. Retry shortly.', 502);
  }
  await open_browser_live_view(db, { ...input, runtime_environment_id, environment });
  const current = await get_runtime_environment(db, {
    workspace_id: input.workspace_id,
    runtime_environment_id,
  });
  if (
    current?.environment_status !== 'running' ||
    current.provider_environment_id !== environment.metadata?.provider_sandbox_id
  ) {
    throw new ConflictError('The chat environment changed. Retry the browser shortly.');
  }
  const previews = await list_session_sandbox_url_previews(db, input);
  const preview = previews?.find(
    (item) =>
      item.runtime_environment_id === runtime_environment_id &&
      item.preview_kind === 'browser_live_view' &&
      item.live_view_token,
  );
  if (!preview)
    throw new AppError('browser_start_failed', 'The browser did not return a live view.', 502);
  return preview;
}
