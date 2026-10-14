import { randomUUID } from 'node:crypto';
import type { SessionEnvBackgroundCommandStatus } from '@agent-core/environment';
import { env } from '@coworker/config';
import { create_logger } from '@coworker/shared';
import {
  create_e2b_command_env,
  e2b_workspace_root,
} from '@runtime-platform/orchestrator/e2b_command';
import { CommandExitError, type CommandHandle, type Sandbox } from 'e2b';

type E2bSandbox = Awaited<ReturnType<typeof Sandbox.create>>;
const log = create_logger('e2b_background_commands');

const active_e2b_background_commands = new Map<string, E2bBackgroundCommand>();

export const background_command_output_limit_bytes = 64_000;
export const preview_output_limit_bytes = 4_000;

export type E2bBackgroundCommandKind = 'command' | 'preview';

export type E2bBackgroundCommand = {
  background_command_id: string;
  kind: E2bBackgroundCommandKind;
  sandbox_id: string;
  handle: CommandHandle;
  command: string;
  cwd: string;
  started_time: string;
  output: { stdout: string; stderr: string };
  exit_result: { exit_code?: number };
  exit: Promise<void>;
};

export type StartE2bBackgroundCommandInput = {
  command: string;
  cwd: string;
  kind?: E2bBackgroundCommandKind;
  background_command_id?: string;
  output_limit_bytes?: number;
  signal?: AbortSignal;
  env?: Record<string, string>;
};

export async function start_e2b_background_command(
  sandbox: E2bSandbox,
  input: StartE2bBackgroundCommandInput,
): Promise<E2bBackgroundCommand> {
  const output_limit_bytes = input.output_limit_bytes ?? background_command_output_limit_bytes;
  const output = { stdout: '', stderr: '' };
  const handle = await sandbox.commands.run(input.command, {
    cwd: input.cwd,
    background: true,
    timeoutMs: input.kind === 'preview' ? 0 : env.COWORKER_E2B_TIMEOUT_MS,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
    envs: create_e2b_command_env(input.env),
    onStdout: (data) => {
      output.stdout = `${output.stdout}${data}`.slice(-output_limit_bytes);
    },
    onStderr: (data) => {
      output.stderr = `${output.stderr}${data}`.slice(-output_limit_bytes);
    },
  });

  const exit_result: E2bBackgroundCommand['exit_result'] = {};
  const background_command: E2bBackgroundCommand = {
    background_command_id: input.background_command_id ?? `bg_${randomUUID().slice(0, 8)}`,
    kind: input.kind ?? 'command',
    sandbox_id: sandbox.sandboxId,
    handle,
    command: input.command,
    cwd: input.cwd,
    started_time: new Date().toISOString(),
    output,
    exit_result,
    exit: watch_background_command_exit(handle, exit_result),
  };
  active_e2b_background_commands.set(registry_key(background_command), background_command);
  return background_command;
}

// handle.wait() rejects with CommandExitError for a non-zero exit, which is an ordinary
// outcome for a background job, not a failure of ours. Both branches record the code and
// nothing rethrows, so this promise never surfaces as an unhandled rejection.
function watch_background_command_exit(
  handle: CommandHandle,
  exit_result: E2bBackgroundCommand['exit_result'],
) {
  return handle.wait().then(
    (result) => {
      exit_result.exit_code = result.exitCode;
    },
    (error) => {
      exit_result.exit_code = error instanceof CommandExitError ? error.exitCode : 1;
    },
  );
}

export function preview_background_command_id(port: number) {
  return `preview-${port}`;
}

export function find_e2b_background_command(sandbox_id: string, background_command_id: string) {
  return active_e2b_background_commands.get(registry_key({ sandbox_id, background_command_id }));
}

export function list_e2b_background_commands(
  sandbox_id: string,
  kind: E2bBackgroundCommandKind = 'command',
) {
  return [...active_e2b_background_commands.values()].filter(
    (background_command) =>
      background_command.sandbox_id === sandbox_id && background_command.kind === kind,
  );
}

export async function wait_for_e2b_background_command_exit(
  background_command: E2bBackgroundCommand,
  wait_ms: number,
) {
  if (background_command.exit_result.exit_code !== undefined || wait_ms <= 0) return;
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      background_command.exit,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, wait_ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function stop_e2b_background_command(
  sandbox: E2bSandbox,
  background_command: E2bBackgroundCommand,
) {
  active_e2b_background_commands.delete(registry_key(background_command));
  await kill_background_command_tree(sandbox, background_command.handle.pid);
  await background_command.handle.kill().catch((error) => log.warn('kill failed', { error }));
}

// E2B's handle.kill() signals the tracked pid only, so `npm install`, a dev server, or a `sh -c`
// wrapper leaves children running that keep the Archil mount busy at teardown. The command is not
// a process-group leader, so a group kill hits nothing (proven live). Walk the process table and
// kill every descendant BEFORE handle.kill(): killing the root first reparents the children to
// init, where no walk finds them. A child that daemonized away is out of reach; previews cover it
// with their port sweep.
async function kill_background_command_tree(sandbox: E2bSandbox, pid: number) {
  const collect_descendants =
    `ps -eo pid=,ppid= | awk -v root=${pid} '` +
    '{ pid_of[NR]=$1; parent_of[NR]=$2 } END { ' +
    'n=1; queue[1]=root; seen[root]=1; ' +
    'while (n > 0) { current=queue[n]; n--; printf "%s ", current; ' +
    'for (i=1; i<=NR; i++) if (parent_of[i]==current && !seen[pid_of[i]]) ' +
    "{ seen[pid_of[i]]=1; queue[++n]=pid_of[i] } } }'";
  await sandbox.commands
    .run(`pids=$(${collect_descendants}); kill -9 $pids 2>/dev/null || true`, {
      cwd: e2b_workspace_root,
      timeoutMs: 5_000,
      envs: create_e2b_command_env(),
    })
    .catch((error) => log.warn('background command tree kill failed', { pid, error }));
}

export async function stop_e2b_background_commands(sandbox: E2bSandbox) {
  const background_commands = sandbox_background_commands(sandbox.sandboxId);
  const results = await Promise.allSettled(
    background_commands.map((background_command) =>
      stop_e2b_background_command(sandbox, background_command),
    ),
  );
  const errors = results
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => result.reason);
  if (errors.length > 0) {
    throw new AggregateError(errors, 'Could not stop E2B background processes.');
  }
}

export function forget_e2b_background_commands(sandbox_id: string) {
  for (const background_command of sandbox_background_commands(sandbox_id)) {
    active_e2b_background_commands.delete(registry_key(background_command));
  }
}

export function e2b_background_command_status(
  background_command: E2bBackgroundCommand,
): SessionEnvBackgroundCommandStatus {
  const exit_code = background_command.exit_result.exit_code;
  return {
    background_command_id: background_command.background_command_id,
    status: exit_code === undefined ? 'running' : 'exited',
    ...(exit_code === undefined ? {} : { exit_code }),
    command: background_command.command,
    cwd: background_command.cwd,
    started_time: background_command.started_time,
    stdout: background_command.output.stdout,
    stderr: background_command.output.stderr,
  };
}

function sandbox_background_commands(sandbox_id: string) {
  return [...active_e2b_background_commands.values()].filter(
    (background_command) => background_command.sandbox_id === sandbox_id,
  );
}

function registry_key(background_command: { sandbox_id: string; background_command_id: string }) {
  return `${background_command.sandbox_id}:${background_command.background_command_id}`;
}
