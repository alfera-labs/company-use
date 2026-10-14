import type {
  SessionEnv,
  SessionEnvCommandResult,
  SessionEnvFileEntry,
  SessionEnvGlobInput,
  SessionEnvGrepInput,
  SessionEnvGrepMatch,
  SessionEnvListInput,
  SessionEnvPreviewInput,
  SessionEnvPreviewResult,
} from '@agent-core/environment';
import { env } from '@coworker/config';
import { create_logger, format_error_message, sleep } from '@coworker/shared';
import type { PlannedSessionEnv } from '@runtime-platform/orchestrator/deferred_session_env';
import {
  type E2bBackgroundCommand,
  e2b_background_command_status,
  find_e2b_background_command,
  forget_e2b_background_commands,
  list_e2b_background_commands,
  preview_background_command_id,
  preview_output_limit_bytes,
  start_e2b_background_command,
  stop_e2b_background_command,
  stop_e2b_background_commands,
  wait_for_e2b_background_command_exit,
} from '@runtime-platform/orchestrator/e2b_background_commands';
import {
  create_e2b_command_env,
  e2b_working_directory,
  e2b_workspace_root,
  join_shell_command,
  quote_shell_argument,
} from '@runtime-platform/orchestrator/e2b_command';
import {
  e2b_cwd,
  e2b_path,
  glob_shell_command,
  no_open_memory_slugs,
  relative_e2b_path,
  split_writable_paths,
} from '@runtime-platform/orchestrator/e2b_sandbox_paths';
import {
  assert_archil_mount_healthy,
  E2bVolumeError,
  E2bWorkspaceStopError,
  link_sandbox_workspace,
  mount_archil_volume,
  prepare_archil_volume,
} from '@runtime-platform/orchestrator/e2b_volume';
import { stop_e2b_sandbox_instance } from '@runtime-platform/orchestrator/e2b_volume_teardown';
import { run_with_e2b_write_ownership } from '@runtime-platform/orchestrator/e2b_write_ownership';
import type { SandboxNetworkRules } from '@runtime-platform/orchestrator/sandbox_credential_headers';
import { trust_the_egress_proxy_certificate } from '@runtime-platform/orchestrator/sandbox_proxy_certificate';
import {
  memory_root_open_slugs_key,
  read_open_memory_slugs,
} from '@runtime-platform/storage/memory_root';
import {
  type OpenVolume,
  volume_sandbox_lifetime_ms,
} from '@runtime-platform/storage/volume_runtime';
import {
  volume_workspace_path,
  workspace_layout_for_version,
} from '@runtime-platform/storage/workspace_layouts';
import {
  CommandExitError,
  type EntryInfo,
  FileNotFoundError,
  Sandbox,
  SandboxNotFoundError,
  TimeoutError,
} from 'e2b';

type E2bSandbox = Awaited<ReturnType<typeof Sandbox.create>>;

const log = create_logger('e2b_sandbox_client');

export {
  glob_shell_command,
  path_is_on_workspace_volume,
} from '@runtime-platform/orchestrator/e2b_sandbox_paths';

export type CreateE2bSessionEnvInput = {
  runtime_environment_id: string;
  sandbox_id?: string;
  workspace_mount_key: string;
  run_id: string;
  agent_id: string;
  host_workspace_root: string;
  workspace_directories: string[];
  command_env?: Record<string, string>;
  volume?: OpenVolume;
  on_sandbox_created?: (provider_sandbox_id: string) => Promise<void>;
  network_rules?: SandboxNetworkRules;
  memory_root_open_slugs?: readonly string[];
};

const unavailable_preview_statuses = new Set([502, 503, 504]);

export class E2bPreviewUnavailableError extends Error {
  constructor(
    message: string,
    public readonly status = 502,
    public readonly response_text?: string,
  ) {
    super(message);
  }
}

export type RestartE2bPreviewInput = {
  provider_sandbox_id: string;
  port: number;
  command: string;
  args?: string[];
  cwd?: string;
  ready_path?: string;
  timeout_ms?: number;
  signal?: AbortSignal;
};

export async function create_e2b_session_env(input: CreateE2bSessionEnvInput): Promise<SessionEnv> {
  const sandbox = await open_e2b_session_sandbox(input);
  await prepare_e2b_session_sandbox(sandbox, input);
  const metadata = e2b_session_metadata(sandbox, input);
  return create_e2b_file_environment(sandbox, input, metadata);
}

export async function connect_e2b_session_env(
  input: CreateE2bSessionEnvInput & { sandbox_id: string; timeout_ms?: number },
): Promise<SessionEnv | null> {
  let sandbox: E2bSandbox;
  try {
    sandbox = await Sandbox.connect(input.sandbox_id, {
      timeoutMs:
        input.timeout_ms ??
        (input.volume ? volume_sandbox_lifetime_ms : env.COWORKER_E2B_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof SandboxNotFoundError) return null;
    throw error;
  }
  if (input.network_rules) {
    await sandbox.updateNetwork({ rules: input.network_rules });
    await trust_the_egress_proxy_certificate(sandbox);
  }
  if (input.volume) {
    await assert_archil_mount_healthy(sandbox, input.volume.root_path);
    await link_sandbox_workspace(
      sandbox,
      input.run_id,
      input.volume.root_path,
      workspace_layout_for_version(input.volume.workspace_layout_version),
    );
  }
  return create_e2b_file_environment(sandbox, input, e2b_session_metadata(sandbox, input));
}

async function open_e2b_session_sandbox(input: CreateE2bSessionEnvInput) {
  const resumed = input.sandbox_id
    ? await connect_session_sandbox(input.sandbox_id, input.volume)
    : undefined;
  if (resumed) {
    // A resumed sandbox kept the rules it was created with, and a session may
    // have been renewed since. updateNetwork replaces the set, so this is a
    // correction rather than an addition.
    if (input.network_rules) await resumed.updateNetwork({ rules: input.network_rules });
    return resumed;
  }
  return Sandbox.create(env.COWORKER_E2B_TEMPLATE_ID, {
    ...(input.network_rules ? { network: { rules: input.network_rules } } : {}),
    timeoutMs: input.volume ? volume_sandbox_lifetime_ms : env.COWORKER_E2B_TIMEOUT_MS,
    lifecycle:
      env.COWORKER_E2B_AUTO_PAUSE && !input.volume
        ? { onTimeout: 'pause', autoResume: true }
        : { onTimeout: 'kill' },
    metadata: {
      workspace_mount_key: input.workspace_mount_key,
      runtime_environment_id: input.runtime_environment_id,
    },
  });
}

async function connect_session_sandbox(sandbox_id: string, volume: OpenVolume | undefined) {
  try {
    return await Sandbox.connect(sandbox_id, {
      timeoutMs: volume ? volume_sandbox_lifetime_ms : env.COWORKER_E2B_TIMEOUT_MS,
    });
  } catch (error) {
    if (!volume && !(error instanceof SandboxNotFoundError)) throw error;
    log.info('Previous session sandbox is gone; starting a fresh one.', {
      sandbox_id,
      error: format_error_message(error),
    });
    return undefined;
  }
}

async function prepare_e2b_session_sandbox(sandbox: E2bSandbox, input: CreateE2bSessionEnvInput) {
  let volume_mounted = false;
  try {
    await input.on_sandbox_created?.(sandbox.sandboxId);
    if (input.volume) {
      try {
        await mount_archil_volume(sandbox, input.volume);
        volume_mounted = true;
        await assert_archil_mount_healthy(sandbox, input.volume.root_path);
        await prepare_archil_volume(sandbox, input.volume, {
          run_id: input.run_id,
          agent_id: input.agent_id,
        });
      } catch (error) {
        throw new E2bVolumeError(
          `Could not mount persistent volume: ${format_error_message(error)}`,
          {
            cause: error,
          },
        );
      }
    }
    await create_e2b_workspace_layout(sandbox, input.workspace_directories);
    // Only when a credential is being attached: that is the only time E2B
    // terminates TLS, and so the only time the browser needs to trust it.
    if (input.network_rules) await trust_the_egress_proxy_certificate(sandbox);
  } catch (error) {
    await clean_failed_e2b_session_start(
      sandbox,
      input.volume,
      input.agent_id,
      volume_mounted,
      error,
    );
    throw error;
  }
}

async function clean_failed_e2b_session_start(
  sandbox: E2bSandbox,
  volume: OpenVolume | undefined,
  agent_id: string,
  volume_mounted: boolean,
  error: unknown,
) {
  if (!volume) return;
  try {
    if (volume_mounted) {
      await stop_e2b_sandbox_instance(sandbox, {
        archil_root_path: volume.root_path,
        agent_workspace_path: volume_workspace_path(
          agent_id,
          workspace_layout_for_version(volume.workspace_layout_version),
        ),
        workspace_layout_version: volume.workspace_layout_version,
      });
    } else {
      await sandbox.kill();
    }
  } catch (cleanup_error) {
    throw new E2bWorkspaceStopError(
      `Persistent workspace initialization failed and cleanup was not confirmed: ${format_error_message(error)}; ${format_error_message(cleanup_error)}`,
      { cause: new AggregateError([error, cleanup_error]) },
    );
  }
}

export function e2b_planned_session_env(input: {
  runtime_environment_id: string;
  workspace_mount_key: string;
  host_workspace_root: string;
  volume?: OpenVolume;
  memory_root_open_slugs?: readonly string[];
}): PlannedSessionEnv {
  return {
    env_key: input.workspace_mount_key,
    env_kind: 'remote_sandbox',
    working_directory: e2b_working_directory,
    metadata: {
      runtime_environment_id: input.runtime_environment_id,
      environment_provider: 'e2b',
      provider_template_id: env.COWORKER_E2B_TEMPLATE_ID,
      workspace_mount_key: input.workspace_mount_key,
      workspace_dir: e2b_workspace_root,
      host_workspace_root: input.host_workspace_root,
      model_workspace_root: e2b_workspace_root,
      model_working_directory: e2b_working_directory,
      agent_tools_address_files_by: 'workspace_absolute_path' as const,
      preview_port: 3000,
      preview_requires_proxy: true,
      [memory_root_open_slugs_key]: [...(input.memory_root_open_slugs ?? [])],
      ...(input.volume
        ? {
            volume_id: input.volume.volume_id,
            volume_provider: input.volume.provider,
            volume_root_path: input.volume.root_path,
            workspace_layout_version: input.volume.workspace_layout_version,
          }
        : {}),
    },
  };
}

function e2b_session_metadata(sandbox: E2bSandbox, input: CreateE2bSessionEnvInput) {
  return {
    ...e2b_planned_session_env(input).metadata,
    provider_environment_id: sandbox.sandboxId,
    provider_sandbox_id: sandbox.sandboxId,
    provider_preview_host: sandbox.getHost(3000),
  };
}

function create_e2b_file_environment(
  sandbox: E2bSandbox,
  input: CreateE2bSessionEnvInput,
  metadata: ReturnType<typeof e2b_session_metadata>,
): SessionEnv {
  const agent_workspace = volume_workspace_path(
    input.agent_id,
    workspace_layout_for_version(input.volume?.workspace_layout_version),
  );
  const open_slugs = () => read_open_memory_slugs(metadata);
  const sandbox_path = (workspace_path: string) => e2b_path(workspace_path, open_slugs());
  const owner = { sandbox, volume: input.volume, agent_workspace_path: agent_workspace };
  return {
    env_key: input.workspace_mount_key,
    env_kind: 'remote_sandbox',
    working_directory: e2b_working_directory,
    metadata,
    exec: (exec_input) => run_e2b_command(owner, open_slugs(), exec_input, input.command_env),
    read: (workspace_path) => sandbox.files.read(sandbox_path(workspace_path)),
    read_bytes: (workspace_path) =>
      sandbox.files.read(sandbox_path(workspace_path), { format: 'bytes' }),
    write_bytes: async (workspace_path, source) =>
      write_e2b_file(owner, sandbox_path(workspace_path), source),
    stat: async (workspace_path) => stat_e2b_file(sandbox, sandbox_path(workspace_path)),
    write: async (workspace_path, contents) =>
      write_e2b_file(owner, sandbox_path(workspace_path), contents),
    edit: async (edit_input) => edit_e2b_file(owner, sandbox_path(edit_input.path), edit_input),
    list: async (list_input) =>
      list_e2b_files(sandbox, sandbox_path(list_input?.path ?? '.'), list_input),
    grep: async (grep_input) =>
      grep_e2b_files(sandbox, sandbox_path(grep_input.path ?? '.'), grep_input),
    glob: (glob_input) => glob_e2b_files(sandbox, glob_input, open_slugs()),
    start_preview: async (preview_input) =>
      start_e2b_preview(sandbox, with_sandbox_cwd(preview_input, open_slugs()), input.command_env),
    start_background_command: async (background_input) =>
      start_e2b_background_job(sandbox, with_sandbox_cwd(background_input, open_slugs())),
    check_background_command: (check_input) => check_e2b_background_job(sandbox, check_input),
    stop_background_command: (stop_input) => stop_e2b_background_job(sandbox, stop_input),
    list_background_commands: async () =>
      list_e2b_background_commands(sandbox.sandboxId).map(e2b_background_command_status),
    read_file: (workspace_path) => sandbox.files.read(sandbox_path(workspace_path)),
    write_file: async (workspace_path, contents) =>
      write_e2b_file(owner, sandbox_path(workspace_path), contents),
    run_command: (command, args) =>
      run_e2b_command(
        owner,
        open_slugs(),
        { command, args, cwd: e2b_working_directory },
        input.command_env,
      ),
  };
}

type E2bWriteOwner = {
  sandbox: E2bSandbox;
  volume: OpenVolume | undefined;
  agent_workspace_path: string;
};

function with_sandbox_cwd<Input extends { cwd?: string }>(
  command_input: Input,
  open_slugs: ReadonlySet<string>,
): Input {
  return { ...command_input, cwd: e2b_cwd(command_input.cwd ?? e2b_working_directory, open_slugs) };
}

type E2bFileSource = string | ArrayBuffer | ReadableStream<unknown> | Blob;

async function write_e2b_file(owner: E2bWriteOwner, target_path: string, source: E2bFileSource) {
  const { sandbox, volume, agent_workspace_path } = owner;
  await run_with_e2b_write_ownership(sandbox, volume, agent_workspace_path, [target_path], () =>
    sandbox.files.write(target_path, source),
  );
}

async function stat_e2b_file(sandbox: E2bSandbox, target_path: string) {
  try {
    const metadata = await sandbox.files.getInfo(target_path);
    return {
      kind: metadata.symlinkTarget
        ? ('symlink' as const)
        : metadata.type === 'file'
          ? ('file' as const)
          : metadata.type === 'dir'
            ? ('directory' as const)
            : ('other' as const),
      byte_size: metadata.size,
    };
  } catch (error) {
    if (error instanceof FileNotFoundError) return null;
    throw error;
  }
}

async function edit_e2b_file(
  owner: E2bWriteOwner,
  target_path: string,
  edit_input: Parameters<NonNullable<SessionEnv['edit']>>[0],
) {
  const { sandbox, volume, agent_workspace_path } = owner;
  return run_with_e2b_write_ownership(
    sandbox,
    volume,
    agent_workspace_path,
    [target_path],
    async () => {
      const contents = await sandbox.files.read(target_path);
      const replacements = count_replacements(
        contents,
        edit_input.old_text,
        edit_input.replace_all,
      );
      if (replacements === 0) return { replacements: 0 };
      const updated = edit_input.replace_all
        ? contents.split(edit_input.old_text).join(edit_input.new_text)
        : contents.replace(edit_input.old_text, edit_input.new_text);
      await sandbox.files.write(target_path, updated);
      return { replacements };
    },
  );
}

export function set_e2b_sandbox_idle_timeout(provider_sandbox_id: string) {
  return Sandbox.setTimeout(provider_sandbox_id, env.COWORKER_E2B_TIMEOUT_MS);
}

export async function pause_e2b_sandbox(provider_sandbox_id: string) {
  await Sandbox.pause(provider_sandbox_id);
}

export function kill_e2b_sandbox(provider_sandbox_id: string) {
  forget_e2b_background_commands(provider_sandbox_id);
  return Sandbox.kill(provider_sandbox_id);
}

export async function stop_e2b_sandbox(
  input: Omit<Parameters<typeof stop_e2b_sandbox_instance>[1], 'stop_previews'> & {
    provider_sandbox_id: string;
  },
) {
  let sandbox: E2bSandbox;
  try {
    sandbox = await Sandbox.connect(input.provider_sandbox_id, {
      timeoutMs: env.COWORKER_E2B_TIMEOUT_MS,
    });
  } catch (error) {
    if (!(error instanceof SandboxNotFoundError)) throw error;
    forget_e2b_background_commands(input.provider_sandbox_id);
    return { volume_synced: false, sandbox_kept: false };
  }
  const { sandbox_kept } = await stop_e2b_sandbox_instance(sandbox, {
    ...input,
    stop_previews: () => stop_e2b_background_commands(sandbox),
  });
  forget_e2b_background_commands(input.provider_sandbox_id);
  return { volume_synced: Boolean(input.archil_root_path), sandbox_kept };
}
export async function restart_e2b_preview(
  input: RestartE2bPreviewInput,
): Promise<SessionEnvPreviewResult> {
  const sandbox = await Sandbox.connect(input.provider_sandbox_id, {
    timeoutMs: env.COWORKER_E2B_TIMEOUT_MS,
  });
  const preview_input = {
    command: input.command,
    args: input.args ?? [],
    port: input.port,
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    ...(input.ready_path === undefined ? {} : { ready_path: input.ready_path }),
    ...(input.timeout_ms === undefined ? {} : { timeout_ms: input.timeout_ms }),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  };
  return start_e2b_preview(sandbox, with_sandbox_cwd(preview_input, no_open_memory_slugs));
}

export async function is_e2b_preview_ready(input: {
  provider_sandbox_id: string;
  port: number;
  ready_path?: string;
}) {
  try {
    const sandbox = await Sandbox.connect(input.provider_sandbox_id, {
      timeoutMs: env.COWORKER_E2B_TIMEOUT_MS,
    });
    await run_preview_ready_probe(
      sandbox,
      input.port,
      normalize_ready_path(input.ready_path ?? '/'),
    );
    return true;
  } catch {
    return false;
  }
}

export async function proxy_e2b_preview_request(input: {
  provider_sandbox_id: string;
  port: number;
  path: string;
  search: string;
  request: Request;
  public_base_url: string;
}) {
  const sandbox = await Sandbox.connect(input.provider_sandbox_id, {
    timeoutMs: env.COWORKER_E2B_TIMEOUT_MS,
  });
  const provider_host = sandbox.getHost(input.port);
  const provider_origin = `https://${provider_host}`;
  const target_url = new URL(provider_origin);
  target_url.pathname = input.path.startsWith('/') ? input.path : `/${input.path}`;
  target_url.search = input.search;

  const headers = proxy_request_headers(input.request.headers);
  const request_init: RequestInit & { duplex?: 'half' } = {
    method: input.request.method,
    headers,
    redirect: 'manual',
    ...(input.request.method === 'GET' || input.request.method === 'HEAD'
      ? {}
      : { body: input.request.body, duplex: 'half' }),
  };
  const response = await fetch_provider_preview(target_url, request_init);
  await throw_if_preview_is_unavailable(response);
  const response_headers = proxy_response_headers(response.headers, {
    provider_origin,
    public_base_url: input.public_base_url,
  });

  if (is_html_response(response_headers)) {
    const html = await response.text();
    return new Response(rewrite_preview_html(html, input.public_base_url), {
      status: response.status,
      statusText: response.statusText,
      headers: response_headers,
    });
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response_headers,
  });
}

export async function read_e2b_workspace_bytes(input: {
  runtime_environment_metadata: unknown;
  provider_environment_id?: string | null;
  workspace_path: string;
}) {
  const sandbox_id =
    input.provider_environment_id ?? read_e2b_sandbox_id(input.runtime_environment_metadata);
  if (!sandbox_id) throw new Error('E2B artifact read requires provider_sandbox_id');
  const sandbox = await Sandbox.connect(sandbox_id, { timeoutMs: env.COWORKER_E2B_TIMEOUT_MS });
  return sandbox.files.read(e2b_path(input.workspace_path, no_open_memory_slugs), {
    format: 'bytes',
  });
}

function read_e2b_sandbox_id(metadata: unknown) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined;
  const value = (metadata as Record<string, unknown>).provider_sandbox_id;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

async function create_e2b_workspace_layout(sandbox: E2bSandbox, directories: string[]) {
  const paths = [
    e2b_workspace_root,
    ...directories.map((directory) => e2b_path(directory, no_open_memory_slugs)),
  ];
  await sandbox.commands.run(`mkdir -p -- ${paths.map(quote_shell_argument).join(' ')}`);
}

async function run_e2b_command(
  owner: E2bWriteOwner,
  open_slugs: ReadonlySet<string>,
  input: {
    command: string;
    args?: string[];
    cwd?: string;
    writable_paths?: string[];
    timeout_ms?: number;
    signal?: AbortSignal;
  },
  default_env: Record<string, string> = {},
): Promise<SessionEnvCommandResult> {
  const { sandbox, volume, agent_workspace_path } = owner;
  const command = join_shell_command([input.command, ...(input.args ?? [])]);
  const cwd = e2b_cwd(input.cwd ?? e2b_working_directory, open_slugs);
  const writable_paths = split_writable_paths(input.writable_paths ?? [], open_slugs);
  if (input.timeout_ms !== undefined) await keep_sandbox_alive_for(sandbox, input.timeout_ms);
  try {
    if (writable_paths.ignored_paths.length > 0) {
      log.debug('Ignored writable paths that are not on the workspace volume.', {
        ignored_paths: writable_paths.ignored_paths,
      });
    }
    const result = await run_with_e2b_write_ownership(
      sandbox,
      volume,
      agent_workspace_path,
      writable_paths.volume_paths,
      () =>
        sandbox.commands.run(command, {
          cwd,
          timeoutMs: input.timeout_ms ?? 30_000,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
          envs: create_e2b_command_env(default_env),
        }),
    );
    return {
      exit_code: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    if (error instanceof CommandExitError) {
      return {
        exit_code: error.exitCode,
        stdout: error.stdout,
        stderr: error.stderr || error.error || '',
      };
    }
    if (error instanceof TimeoutError) {
      return {
        exit_code: 124,
        stdout: '',
        stderr: error.message,
        timed_out: true,
      };
    }
    throw error;
  }
}

// A sandbox expires on its own clock and takes any running command with it. E2B's
// setTimeout counts from now and can shorten a lifetime as well as extend it, so read the
// current expiry first and only ever push it out. Short commands skip the round trip:
// nothing under the default command timeout has ever been what outlived a sandbox.
const sandbox_lifetime_check_threshold_ms = 120_000;
const sandbox_lifetime_grace_ms = 60_000;

export async function keep_sandbox_alive_for(sandbox: E2bSandbox, needed_ms: number) {
  if (needed_ms <= sandbox_lifetime_check_threshold_ms) return;
  const lifetime_ms = Math.min(needed_ms + sandbox_lifetime_grace_ms, volume_sandbox_lifetime_ms);
  try {
    const info = await sandbox.getInfo();
    if (info.endAt.getTime() - Date.now() >= lifetime_ms) return;
    await sandbox.setTimeout(lifetime_ms);
  } catch (error) {
    log.warn('Could not extend the sandbox lifetime for a long-running command.', {
      sandbox_id: sandbox.sandboxId,
      needed_ms,
      error: format_error_message(error),
    });
  }
}

async function start_e2b_background_job(
  sandbox: E2bSandbox,
  input: {
    command: string;
    args?: string[];
    cwd?: string;
    signal?: AbortSignal;
  },
) {
  await keep_sandbox_alive_for(sandbox, env.COWORKER_E2B_TIMEOUT_MS);
  const background_command = await start_e2b_background_command(sandbox, {
    command: join_shell_command([input.command, ...(input.args ?? [])]),
    cwd: input.cwd ?? e2b_working_directory,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  return e2b_background_command_status(background_command);
}

async function check_e2b_background_job(
  sandbox: E2bSandbox,
  input: { background_command_id: string; wait_seconds?: number },
) {
  const background_command = find_e2b_background_command(
    sandbox.sandboxId,
    input.background_command_id,
  );
  if (!background_command) return null;
  await wait_for_e2b_background_command_exit(background_command, (input.wait_seconds ?? 0) * 1000);
  return e2b_background_command_status(background_command);
}

async function stop_e2b_background_job(
  sandbox: E2bSandbox,
  input: { background_command_id: string },
) {
  const background_command = find_e2b_background_command(
    sandbox.sandboxId,
    input.background_command_id,
  );
  if (!background_command) return null;
  await stop_e2b_background_command(sandbox, background_command);
  return e2b_background_command_status(background_command);
}

async function start_e2b_preview(
  sandbox: E2bSandbox,
  input: SessionEnvPreviewInput,
  session_command_env: Record<string, string> = {},
): Promise<SessionEnvPreviewResult> {
  const command = join_shell_command([input.command, ...(input.args ?? [])]);
  const cwd = input.cwd ?? e2b_working_directory;
  await stop_e2b_preview_on_port(sandbox, input.port);

  const env = { ...session_command_env, ...input.env };
  const preview = await start_e2b_background_command(sandbox, {
    command,
    cwd,
    kind: 'preview',
    background_command_id: preview_background_command_id(input.port),
    output_limit_bytes: preview_output_limit_bytes,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
    ...(Object.keys(env).length === 0 ? {} : { env }),
  });
  const provider_host = sandbox.getHost(input.port);
  const ready_path = normalize_ready_path(input.ready_path ?? '/');
  const ready_url = `https://${provider_host}${ready_path}`;

  await confirm_e2b_preview_ready(sandbox, preview, input, ready_path);

  return {
    port: input.port,
    provider_host,
    process_id: preview.handle.pid,
    ready_url,
    command,
    cwd,
  };
}

async function confirm_e2b_preview_ready(
  sandbox: E2bSandbox,
  preview: E2bBackgroundCommand,
  input: SessionEnvPreviewInput,
  ready_path: string,
) {
  try {
    await wait_for_preview_ready(
      sandbox,
      input.port,
      ready_path,
      input.timeout_ms ?? 60_000,
      input.signal,
    );
  } catch (error) {
    await stop_e2b_background_command(sandbox, preview);
    const message = format_error_message(error);
    throw new Error(
      [
        `Preview server did not become ready on port ${input.port}: ${message}`,
        preview.output.stdout ? `stdout:\n${preview.output.stdout}` : '',
        preview.output.stderr ? `stderr:\n${preview.output.stderr}` : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    );
  }
}

async function wait_for_preview_ready(
  sandbox: E2bSandbox,
  port: number,
  ready_path: string,
  timeout_ms: number,
  signal?: AbortSignal,
) {
  const deadline = Date.now() + timeout_ms;
  let last_error_message = 'not ready';

  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error('Preview start was aborted.');
    try {
      await run_preview_ready_probe(sandbox, port, ready_path);
      return;
    } catch (error) {
      last_error_message = format_error_message(error);
    }

    await sleep(750);
  }

  throw new Error(last_error_message);
}

async function run_preview_ready_probe(sandbox: E2bSandbox, port: number, ready_path: string) {
  const ready_url = `http://127.0.0.1:${port}${ready_path}`;
  const result = await sandbox.commands.run(
    `curl -sS --max-time 10 -o /dev/null ${quote_shell_argument(ready_url)}`,
    {
      cwd: e2b_workspace_root,
      timeoutMs: 15_000,
      envs: create_e2b_command_env(),
    },
  );
  if (result.exitCode !== 0) throw new Error('HTTP server is not responding yet');
}

async function stop_e2b_preview_on_port(sandbox: E2bSandbox, port: number) {
  const active_preview = find_e2b_background_command(
    sandbox.sandboxId,
    preview_background_command_id(port),
  );
  if (active_preview) await stop_e2b_background_command(sandbox, active_preview);

  await sandbox.commands
    .run(
      [
        `ss -ltnp 'sport = :${port}'`,
        `sed -n 's/.*pid=\\([0-9][0-9]*\\).*/\\1/p'`,
        `sort -u`,
        `xargs -r kill -9`,
      ].join(' | '),
      {
        cwd: e2b_workspace_root,
        timeoutMs: 5_000,
        envs: create_e2b_command_env(),
      },
    )
    .catch(() => undefined);
}

async function list_e2b_files(
  sandbox: E2bSandbox,
  target_path: string,
  input: SessionEnvListInput = {},
): Promise<SessionEnvFileEntry[]> {
  const entries = await sandbox.files.list(target_path, {
    depth: input.recursive ? (input.max_depth ?? 4) : 1,
  });
  return entries.map(e2b_entry_to_session_entry);
}

async function grep_e2b_files(
  sandbox: E2bSandbox,
  target_path: string,
  input: SessionEnvGrepInput,
): Promise<SessionEnvGrepMatch[]> {
  const max_results = input.max_results ?? 100;
  const result = await sandbox.commands.run(
    grep_shell_command(
      input,
      target_path,
      Number.isFinite(max_results) ? Math.max(1, max_results) : 100,
    ),
    { cwd: e2b_workspace_root },
  );
  const failure = searcher_failure_message(result.stderr);
  if (failure) throw new Error(`Search failed: ${failure}`);
  return parse_grep_output(result.stdout);
}

const searcher_exit_code_prefix = 'coworker-searcher-exit:';

const searcher_exit_codes_that_found_an_answer = new Set([0, 1, 141]);

export function grep_shell_command(
  input: SessionEnvGrepInput,
  target_path: string,
  max_results: number,
) {
  const pattern = quote_shell_argument(input.pattern);
  const target = quote_shell_argument(target_path);
  const case_insensitive = input.case_sensitive === false;
  const ripgrep = `rg --no-heading --line-number --with-filename --no-ignore --hidden --glob '!.git/'${case_insensitive ? ' --ignore-case' : ''} -e ${pattern} -- ${target}`;
  const grep = `grep -E ${case_insensitive ? '-RHInI' : '-RHnI'} -- ${pattern} ${target}`;
  // `command -v` decides per call rather than caching: a sandbox outlives this process, and a
  // wrong cached answer would silently return zero matches for the rest of the session.
  //
  // The searcher's exit code travels on stderr, not as the command's own exit code, because `head`
  // ends the pipeline and reports its own. It cannot travel on stdout either: `head` cuts stdout at
  // max_results, so a status printed there disappears on exactly the searches that found the most.
  return [
    `(if command -v rg >/dev/null 2>&1; then ${ripgrep}; else ${grep}; fi; echo "${searcher_exit_code_prefix}$?" >&2)`,
    `head -n ${max_results}`,
  ].join(' | ');
}

export function searcher_failure_message(stderr: string): string | undefined {
  const lines = stderr
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean);
  const exit_code_line = lines.filter((line) => line.startsWith(searcher_exit_code_prefix)).at(-1);
  if (!exit_code_line) return lines.join('\n') || 'The search did not run.';

  const exit_code = Number.parseInt(exit_code_line.slice(searcher_exit_code_prefix.length), 10);
  if (searcher_exit_codes_that_found_an_answer.has(exit_code)) return undefined;
  const reported = lines.filter((line) => line !== exit_code_line).join('\n');
  return reported || `The search ended with exit code ${exit_code}.`;
}

async function glob_e2b_files(
  sandbox: E2bSandbox,
  input: SessionEnvGlobInput,
  open_slugs: ReadonlySet<string>,
): Promise<string[]> {
  const max_results = input.max_results ?? 100;
  const result = await sandbox.commands.run(
    glob_shell_command(
      input.pattern,
      Number.isFinite(max_results) ? Math.max(1, max_results) : 100,
      open_slugs,
    ),
    { cwd: e2b_workspace_root },
  );
  const paths = result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map(relative_e2b_path);
  if (paths.length === 0 && result.stderr.trim()) {
    throw new Error(`Glob failed: ${result.stderr.trim()}`);
  }
  return paths;
}

function e2b_entry_to_session_entry(entry: EntryInfo): SessionEnvFileEntry {
  return {
    path: relative_e2b_path(entry.path),
    name: entry.name,
    kind: e2b_entry_kind(entry.type),
  };
}

function e2b_entry_kind(type: EntryInfo['type']): SessionEnvFileEntry['kind'] {
  const value = String(type ?? '').toLowerCase();
  if (value === 'file') return 'file';
  if (value === 'dir' || value === 'directory') return 'directory';
  if (value === 'symlink') return 'symlink';
  return 'other';
}

function count_replacements(contents: string, old_text: string, replace_all: boolean | undefined) {
  if (!old_text) return 0;
  if (!contents.includes(old_text)) return 0;
  if (!replace_all) return 1;
  return contents.split(old_text).length - 1;
}

export function parse_grep_output(stdout: string): SessionEnvGrepMatch[] {
  return stdout
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .flatMap((line) => {
      const [path_value = '', line_value = '', ...text_parts] = line.split(':');
      const line_number = Number.parseInt(line_value, 10);
      if (!Number.isInteger(line_number) || line_number <= 0) return [];
      return [
        {
          path: relative_e2b_path(path_value),
          line: line_number,
          text: text_parts.join(':'),
        },
      ];
    });
}

function normalize_ready_path(ready_path: string) {
  if (!ready_path.trim()) return '/';
  return ready_path.startsWith('/') ? ready_path : `/${ready_path}`;
}

function proxy_request_headers(source: Headers) {
  const headers = new Headers(source);
  for (const header of [
    'accept-encoding',
    'authorization',
    'connection',
    'content-length',
    'cookie',
    'host',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'referer',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
    'x-api-key',
    'x-auth-token',
    'x-csrf-token',
    'x-xsrf-token',
  ]) {
    headers.delete(header);
  }
  for (const header of [...headers.keys()]) {
    if (header.startsWith('x-coworker-') || header.startsWith('x-forwarded-')) {
      headers.delete(header);
    }
  }
  return headers;
}

function proxy_response_headers(
  source: Headers,
  input: { provider_origin: string; public_base_url: string },
) {
  const headers = new Headers(source);
  for (const header of [
    'clear-site-data',
    'connection',
    'content-encoding',
    'content-length',
    'content-security-policy',
    'content-security-policy-report-only',
    'cross-origin-embedder-policy',
    'cross-origin-opener-policy',
    'cross-origin-resource-policy',
    'keep-alive',
    'permissions-policy',
    'proxy-authenticate',
    'proxy-authorization',
    'referrer-policy',
    'set-cookie',
    'set-cookie2',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
    'www-authenticate',
    'x-frame-options',
  ]) {
    headers.delete(header);
  }

  const location = headers.get('location');
  if (location?.startsWith(input.provider_origin)) {
    headers.set(
      'location',
      `${input.public_base_url}${location.slice(input.provider_origin.length)}`,
    );
  } else if (location?.startsWith('/')) {
    headers.set('location', `${input.public_base_url}${location}`);
  }
  return headers;
}

function is_html_response(headers: Headers) {
  return headers.get('content-type')?.toLowerCase().includes('text/html') ?? false;
}

async function fetch_provider_preview(url: URL, request_init: RequestInit & { duplex?: 'half' }) {
  try {
    return await fetch(url, request_init);
  } catch (error) {
    const message = format_error_message(error);
    throw new E2bPreviewUnavailableError(`Preview server is unavailable: ${message}`);
  }
}

async function throw_if_preview_is_unavailable(response: Response) {
  if (!unavailable_preview_statuses.has(response.status)) return;

  const response_text = await response
    .clone()
    .text()
    .catch(() => '');
  if (!looks_like_e2b_unavailable_preview(response_text)) return;

  throw new E2bPreviewUnavailableError(
    `Preview server is unavailable: ${response.status}`,
    response.status,
    response_text,
  );
}

function looks_like_e2b_unavailable_preview(response_text: string) {
  const text = response_text.toLowerCase();
  return (
    text.includes('e2b') ||
    text.includes('sandbox') ||
    (text.includes('port') &&
      (text.includes('closed') ||
        text.includes('not open') ||
        text.includes('not ready') ||
        text.includes('unavailable'))) ||
    (text.includes('connection') && text.includes('refused'))
  );
}

function rewrite_preview_html(html: string, public_base_url: string) {
  const base_url = public_base_url.replace(/\/+$/u, '');
  return html
    .replaceAll('href="/', `href="${base_url}/`)
    .replaceAll("href='/", `href='${base_url}/`)
    .replaceAll('src="/', `src="${base_url}/`)
    .replaceAll("src='/", `src='${base_url}/`)
    .replaceAll('action="/', `action="${base_url}/`)
    .replaceAll("action='/", `action='${base_url}/`)
    .replaceAll('"/_next/', `"${base_url}/_next/`)
    .replaceAll("'/_next/", `'${base_url}/_next/`);
}

export {
  E2bVolumeError,
  E2bWorkspaceStopError,
} from '@runtime-platform/orchestrator/e2b_volume';
