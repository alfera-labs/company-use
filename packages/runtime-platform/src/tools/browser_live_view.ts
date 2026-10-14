import {
  agent_browser_live_view_relay_path,
  agent_browser_live_view_relay_port,
  agent_browser_stream_port,
} from '@agent-core/browser/agent_browser_command';
import type { SessionEnv, SessionEnvPreviewResult } from '@agent-core/environment/session_env';
import type { Database } from '@coworker/core';
import { get_runtime_environment } from '@coworker/core/db/queries/sessions';
import { create_logger, format_error_message } from '@coworker/shared';
import { create_browser_live_view_token } from '@runtime-platform/browser/browser_state_config';
import { find_active_preview } from '@runtime-platform/orchestrator/preview_metadata';
import { persist_active_preview } from '@runtime-platform/tools/workspace_preview_persistence';

export const browser_live_view_kind = 'browser_live_view';
const browser_live_view_probe_interval_ms = 5_000;

// The relay is a plain Node script baked into the image. It bridges agent-browser's
// localhost-only viewport stream to the app, which sits on a remote origin the stream server
// would otherwise reject. It reads its port, the upstream stream port, and its auth token from
// the environment we pass here.
const browser_live_view_launch = {
  command: 'node',
  args: [agent_browser_live_view_relay_path],
  ready_path: '/',
};

export type BrowserLiveView = {
  open: () => Promise<void>;
};

type BrowserLiveViewInput = {
  workspace_id: string;
  runtime_environment_id?: string;
  actor_id: string;
  environment: SessionEnv;
};

export function create_browser_live_view(
  db: Database,
  input: BrowserLiveViewInput,
): BrowserLiveView {
  let pending: Promise<void> | undefined;
  let next_probe_time = 0;

  return {
    open: () => {
      if (pending) return pending;
      if (Date.now() < next_probe_time) return Promise.resolve();

      pending = open_browser_live_view(db, input)
        .then(() => {
          next_probe_time = Date.now() + browser_live_view_probe_interval_ms;
        })
        .catch((error) => {
          next_probe_time = 0;
          log.warn('browser live view could not start', {
            runtime_environment_id: input.runtime_environment_id ?? null,
            error: format_error_message(error),
          });
        })
        .finally(() => {
          pending = undefined;
        });
      return pending;
    },
  };
}

export async function open_browser_live_view(db: Database, input: BrowserLiveViewInput) {
  if (!input.runtime_environment_id || !input.environment.start_preview) {
    throw new Error('This environment does not support browser live view.');
  }
  if (await browser_live_view_is_active(db, input)) return;
  const provider_sandbox_id = read_provider_sandbox_id(input.environment);
  if (!provider_sandbox_id) {
    throw new Error('browser live view needs a provider sandbox id');
  }
  const token = create_browser_live_view_token({ sandbox_id: provider_sandbox_id });

  const preview = await input.environment.start_preview({
    ...browser_live_view_launch,
    port: agent_browser_live_view_relay_port,
    env: {
      LIVE_VIEW_RELAY_PORT: String(agent_browser_live_view_relay_port),
      AGENT_BROWSER_STREAM_PORT: String(agent_browser_stream_port),
      AGENT_BROWSER_LIVE_VIEW_TOKEN: token,
    },
    timeout_ms: 15_000,
  });
  if (!preview.provider_host) {
    throw new Error('the live-view relay did not return an E2B provider host');
  }

  await persist_active_preview(db, {
    runtime_environment_id: input.runtime_environment_id,
    active_preview: create_browser_live_view_preview(
      preview,
      preview.provider_host,
      provider_sandbox_id,
      token,
    ),
    preview_port: preview.port,
    mark_environment_running: false,
    actor_id: input.actor_id,
  });
}

function create_browser_live_view_preview(
  preview: SessionEnvPreviewResult,
  provider_host: string,
  provider_sandbox_id: string,
  token: string,
): Record<string, unknown> {
  return {
    port: preview.port,
    preview_name: 'Browser live view',
    preview_kind: browser_live_view_kind,
    preview_transport: 'provider_direct',
    preview_url: `https://${provider_host}`,
    provider_host,
    provider_sandbox_id,
    live_view_token: token,
    process_id: preview.process_id ?? null,
    command: preview.command,
    launch_command: browser_live_view_launch.command,
    launch_args: browser_live_view_launch.args,
    cwd: preview.cwd,
    ready_path: browser_live_view_launch.ready_path,
    started_time: new Date().toISOString(),
  };
}

async function browser_live_view_is_active(
  db: Database,
  input: {
    workspace_id: string;
    runtime_environment_id?: string;
    environment: SessionEnv;
  },
) {
  if (!input.runtime_environment_id) return false;
  const runtime_environment = await get_runtime_environment(db, {
    workspace_id: input.workspace_id,
    runtime_environment_id: input.runtime_environment_id,
  });
  if (!runtime_environment) return false;
  const preview = find_active_preview(
    runtime_environment.environment_metadata,
    agent_browser_live_view_relay_port,
  );
  const provider_sandbox_id = read_provider_sandbox_id(input.environment);
  if (
    preview?.preview_kind === browser_live_view_kind &&
    provider_sandbox_id !== undefined &&
    preview.provider_sandbox_id === provider_sandbox_id
  ) {
    const probe = await input.environment.exec?.({
      command: 'curl',
      args: [
        '--fail',
        '--silent',
        '--show-error',
        '--max-time',
        '2',
        `http://127.0.0.1:${agent_browser_live_view_relay_port}/`,
      ],
      timeout_ms: 3_000,
    });
    return probe?.exit_code === 0;
  }
  return false;
}

function read_provider_sandbox_id(environment: SessionEnv) {
  const metadata: Record<string, unknown> = environment.metadata ?? {};
  for (const key of ['provider_sandbox_id', 'provider_environment_id']) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

const log = create_logger('browser_live_view');
