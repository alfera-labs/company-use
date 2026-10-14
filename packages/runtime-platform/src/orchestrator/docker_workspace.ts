import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import type { SessionEnv } from '@agent-core/environment';
import { scratch_folder_name } from '@agent-core/environment/scratch_mount';
import {
  close_private_addresses_of,
  closed_sandbox_run_arguments,
  find_reason_not_to_run_in,
} from '@runtime-platform/orchestrator/docker_sandbox_guard';
import { wait_for_the_sandbox_image } from '@runtime-platform/orchestrator/docker_sandbox_image';
import { create_sandbox_network_if_missing } from '@runtime-platform/orchestrator/docker_sandbox_network';
import { create_sandbox_env } from '@runtime-platform/orchestrator/sandbox_env';
import {
  session_home_folder,
  type WorkspaceLocation,
} from '@runtime-platform/orchestrator/workspace_location';
import { current_workspace_layout } from '@runtime-platform/storage/workspace_layouts';

const exec_file = promisify(execFile);

const container_workspace_root = current_workspace_layout.model_root;
const container_scratch_root = path.posix.join(container_workspace_root, scratch_folder_name);

export type HostWorkspaceFolders = { host_workspace_root: string; host_scratch_root: string };

function create_container_workspace_command_env() {
  return create_sandbox_env({
    ...(process.env.PATH === undefined ? {} : { PATH: process.env.PATH }),
    HOME: path.posix.join(container_scratch_root, session_home_folder),
    TMPDIR: container_scratch_root,
    USER: 'coworker',
    LOGNAME: 'coworker',
    SHELL: '/bin/bash',
    LANG: process.env.LANG ?? 'C.UTF-8',
    COWORKER_WORKSPACE_ROOT: container_workspace_root,
  });
}

/**
 * The file tools read and write the host folders directly. Commands run in a container that
 * mounts the same two folders, so a path one tool writes is the path a command opens.
 */
export async function create_docker_session_env(
  file_environment: SessionEnv,
  location: WorkspaceLocation,
): Promise<SessionEnv> {
  const { host_workspace_root, host_scratch_root } = location;
  if (!host_scratch_root) throw new Error('A docker workspace needs its session scratch folder.');
  const container_name = docker_container_name(location.workspace_mount_key);
  await start_docker_container(container_name, { host_workspace_root, host_scratch_root });
  return {
    ...file_environment,
    env_kind: 'custom',
    working_directory: container_workspace_root,
    metadata: {
      ...file_environment.metadata,
      environment_provider: 'docker',
      provider_environment_id: container_name,
      workspace_dir: container_workspace_root,
    },
    exec: (exec_input) => run_docker_command(container_name, exec_input),
    run_command: (command, args) => run_docker_command(container_name, { command, args }),
  };
}

function workspace_mounts(folders: HostWorkspaceFolders) {
  const roots = new Set([
    container_workspace_root,
    ...current_workspace_layout.sandbox_workspace_aliases,
  ]);
  return [...roots].flatMap((root) => [
    ...bind_mount(folders.host_workspace_root, root),
    ...bind_mount(folders.host_scratch_root, path.posix.join(root, scratch_folder_name)),
  ]);
}

function bind_mount(source: string, target: string) {
  return ['--mount', `type=bind,source=${source},target=${target}`];
}

export function docker_container_name(workspace_mount_key: string) {
  return `coworker-${workspace_mount_key.replace(/[^a-zA-Z0-9_.-]/g, '-').toLowerCase()}`;
}

async function start_docker_container(container_name: string, folders: HostWorkspaceFolders) {
  const network_name = await create_sandbox_network_if_missing();
  const networks = await read_docker_container_networks(container_name);
  if (networks?.includes(network_name)) {
    await exec_file('docker', ['start', container_name]);
  } else {
    if (networks) await exec_file('docker', ['rm', '--force', container_name]);
    await wait_for_the_sandbox_image();
    await exec_file('docker', docker_run_arguments(container_name, folders, network_name));
  }
  await close_private_addresses_of(container_name);
}

/**
 * How a sandbox container starts. It is on the sandbox network and on no other, and it has no
 * right to change its own network, so the routes taken from it after the start stay taken.
 */
export function docker_run_arguments(
  container_name: string,
  folders: HostWorkspaceFolders,
  network_name: string,
): string[] {
  return [
    'run',
    '--detach',
    '--name',
    container_name,
    '--network',
    network_name,
    ...closed_sandbox_run_arguments(),
    '--user',
    'node',
    '--workdir',
    container_workspace_root,
    ...workspace_mounts(folders),
    '--security-opt',
    'no-new-privileges',
    '--pids-limit',
    '256',
    '--memory',
    '2g',
    '--cpus',
    '2',
    'node:24-bookworm',
    'sleep',
    'infinity',
  ];
}

const names_of_the_networks_it_is_on =
  '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}} {{end}}';

async function read_docker_container_networks(container_name: string): Promise<string[] | null> {
  try {
    const { stdout } = await exec_file('docker', [
      'inspect',
      '--format',
      names_of_the_networks_it_is_on,
      container_name,
    ]);
    return stdout.split(/\s+/u).filter(Boolean);
  } catch {
    return null;
  }
}

async function run_docker_command(
  container_name: string,
  input: {
    command: string;
    args?: string[];
    cwd?: string;
    timeout_ms?: number;
    signal?: AbortSignal;
  },
) {
  const command_env = create_container_workspace_command_env();
  const env_args = Object.entries(command_env).flatMap(([key, value]) => [
    '--env',
    `${key}=${value}`,
  ]);
  const cwd = container_working_directory(input.cwd);
  const refusal = await find_reason_not_to_run_in(container_name).catch(String);
  if (refusal) return { exit_code: 1, stdout: '', stderr: refusal };

  try {
    const result = await exec_file(
      'docker',
      ['exec', '--workdir', cwd, ...env_args, container_name, input.command, ...(input.args ?? [])],
      {
        signal: input.signal,
        timeout: input.timeout_ms ?? 30_000,
        maxBuffer: 1024 * 1024 * 4,
      },
    );
    return { exit_code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const exec_error = error as NodeJS.ErrnoException & {
      killed?: boolean;
      stdout?: string | Buffer;
      stderr?: string | Buffer;
    };
    return {
      exit_code: typeof exec_error.code === 'number' ? exec_error.code : 1,
      stdout: exec_error.stdout?.toString() ?? '',
      stderr: exec_error.stderr?.toString() ?? String(error),
      ...(exec_error.killed ? { timed_out: true } : {}),
    };
  }
}

function container_working_directory(cwd: string | undefined) {
  if (cwd?.startsWith('/')) return path.posix.normalize(cwd);
  return path.posix.join(container_workspace_root, cwd ?? '.');
}
