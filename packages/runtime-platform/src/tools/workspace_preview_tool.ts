import type { SessionEnv, SessionEnvPreviewResult } from '@agent-core/environment';
import type { RuntimeToolContext } from '@agent-core/tools/runtime_tool';
import { env } from '@coworker/config';
import type { Database } from '@coworker/core';
import { create_sandbox_url_preview_url } from '@coworker/core/db/queries/runtime_environments';
import {
  get_runtime_environment,
  update_runtime_environment_state,
} from '@coworker/core/db/queries/sessions';
import {
  find_active_preview,
  list_active_preview_ports,
  with_active_preview_metadata,
} from '@runtime-platform/orchestrator/preview_metadata';
import { browser_live_view_kind } from '@runtime-platform/tools/browser_live_view';
import {
  canonical_shell_working_directory,
  require_workspace_environment,
} from '@runtime-platform/tools/workspace_tool_paths';
import { err, ok_json } from '@runtime-platform/tools/workspace_tool_results';
import { z } from 'zod';

const nonempty_string_schema = z.string().min(1);

export const workspace_preview_input_schema = z
  .object({
    command: nonempty_string_schema,
    args: z.array(z.string()).optional(),
    cwd: z.string().optional(),
    port: z.number().finite().optional(),
    ready_path: nonempty_string_schema.optional(),
    timeout_ms: z.number().finite().optional(),
  })
  .strict();

export type StaticPreviewInput = {
  workspace_id: string;
  runtime_environment_id: string;
  environment: SessionEnv;
  actor_id: string;
};

type RuntimeEnvironment = NonNullable<Awaited<ReturnType<typeof get_runtime_environment>>>;

export async function execute_workspace_preview(
  input: z.infer<typeof workspace_preview_input_schema>,
  context: RuntimeToolContext,
) {
  const environment = require_workspace_environment(context);
  if (!environment.start_preview) {
    return err('preview_unsupported', 'This workspace sandbox does not support HTTP previews yet.');
  }

  const port = parse_preview_port(input.port);
  const command = input.command;
  const args = input.args ?? [];
  const cwd = canonical_shell_working_directory(input.cwd);
  const ready_path = input.ready_path ?? '/';
  const result = await environment.start_preview({
    command,
    args,
    cwd,
    port,
    ready_path,
    timeout_ms: parse_preview_timeout_ms(input.timeout_ms),
    ...(context.signal === undefined ? {} : { signal: context.signal }),
  });
  const preview_url = preview_url_for_result(context, result);
  const active_preview = {
    port: result.port,
    preview_url,
    process_id: result.process_id ?? null,
    command: result.command,
    launch_command: command,
    launch_args: args,
    cwd: result.cwd,
    ready_path,
    started_time: new Date().toISOString(),
  };

  return ok_json(
    {
      preview_url,
      port: result.port,
      process_id: result.process_id ?? null,
      command: result.command,
      cwd: result.cwd,
    },
    { active_preview, active_preview_ports: [result.port] },
  );
}

export async function find_static_preview_target(db: Database, input: StaticPreviewInput) {
  if (!input.environment.start_preview) return undefined;
  const runtime_environment = await get_runtime_environment(db, {
    workspace_id: input.workspace_id,
    runtime_environment_id: input.runtime_environment_id,
  });
  if (!runtime_environment) return undefined;
  const has_active_app_preview = list_active_preview_ports(
    runtime_environment.environment_metadata,
  ).some(
    (port) =>
      find_active_preview(runtime_environment.environment_metadata, port)?.preview_kind !==
      browser_live_view_kind,
  );
  if (has_active_app_preview) return undefined;
  if (!(await workspace_serves_static_site(input.environment))) return undefined;
  return runtime_environment;
}

export async function start_static_preview(
  db: Database,
  input: StaticPreviewInput,
  runtime_environment: RuntimeEnvironment,
) {
  if (!input.environment.start_preview) return;
  const port = env.SANDBOX_PREVIEW_DEFAULT_PORT;
  const launch_command = 'python3';
  const launch_args = ['-m', 'http.server', String(port), '--bind', '0.0.0.0'];
  const result = await input.environment.start_preview({
    command: launch_command,
    args: launch_args,
    cwd: '.',
    port,
    ready_path: '/',
    timeout_ms: 30_000,
  });
  await update_runtime_environment_state(db, {
    runtime_environment_id: input.runtime_environment_id,
    environment_status: 'running',
    environment_metadata: {
      ...with_active_preview_metadata(runtime_environment.environment_metadata, {
        port: result.port,
        process_id: result.process_id ?? null,
        command: result.command,
        launch_command,
        launch_args,
        cwd: result.cwd,
        ready_path: '/',
        started_time: new Date().toISOString(),
      }),
      last_preview_started_time: new Date().toISOString(),
    },
    actor_id: input.actor_id,
  });
}

async function workspace_serves_static_site(environment: SessionEnv) {
  const probe = await environment.exec?.({
    command: 'sh',
    args: ['-lc', 'test -f index.html && ! test -f package.json && echo static'],
    cwd: '.',
    timeout_ms: 10_000,
  });
  return Boolean(probe && probe.exit_code === 0 && probe.stdout.includes('static'));
}

function parse_preview_port(input_port: number | undefined) {
  const port = Math.trunc(input_port ?? 3000);
  if (port < 1 || port > 65_535) throw new Error(`Invalid preview port: ${port}`);
  return port;
}

function parse_preview_timeout_ms(input_timeout_ms: number | undefined) {
  const timeout_ms = input_timeout_ms ?? 60_000;
  if (timeout_ms <= 0) return 60_000;
  return Math.min(timeout_ms, 120_000);
}

function preview_url_for_result(context: RuntimeToolContext, result: SessionEnvPreviewResult) {
  if (env.ENVIRONMENT !== 'production' && result.provider_host) {
    return `https://${result.provider_host}`;
  }
  return coworker_preview_url(context, result.port);
}

function coworker_preview_url(context: RuntimeToolContext, port: number) {
  const metadata = context.environment?.metadata;
  if (!metadata?.runtime_environment_id) {
    throw new Error('Preview URL requires runtime_environment_id.');
  }
  const subdomain_seed =
    metadata.project_description ?? metadata.app_description ?? metadata.workspace_mount_key;
  return create_sandbox_url_preview_url({
    runtime_environment_id: metadata.runtime_environment_id,
    provider_environment_id: metadata.provider_environment_id ?? null,
    preview_base_domain: env.SANDBOX_PREVIEW_BASE_DOMAIN,
    preview_protocol: env.SANDBOX_PREVIEW_PROTOCOL,
    default_port: env.SANDBOX_PREVIEW_DEFAULT_PORT,
    port,
    ...(subdomain_seed ? { subdomain_seed } : {}),
  });
}
