import type { SessionEnvCommandResult } from '@agent-core/environment/session_env';
import type { EvalCommandSpec, EvalHttpCheckSpec, EvalTaskState } from '@coworker/evals/eval_types';

type CommandVariables = Record<string, string>;

export async function run_workspace_command(
  state: EvalTaskState,
  command: EvalCommandSpec,
  variables: CommandVariables = {},
): Promise<SessionEnvCommandResult> {
  if (!state.workspace.environment.exec) {
    throw new Error(`Workspace provider ${state.workspace.provider} does not support exec`);
  }

  const resolved = resolve_command_spec(command, variables);
  if (resolved.env && Object.keys(resolved.env).length > 0) {
    return state.workspace.environment.exec({
      command: 'sh',
      args: ['-c', shell_command_with_env(resolved)],
      ...(resolved.cwd === undefined ? {} : { cwd: resolved.cwd }),
      ...(resolved.timeout_ms === undefined ? {} : { timeout_ms: resolved.timeout_ms }),
    });
  }

  return state.workspace.environment.exec({
    command: resolved.command,
    ...(resolved.args === undefined ? {} : { args: resolved.args }),
    ...(resolved.cwd === undefined ? {} : { cwd: resolved.cwd }),
    ...(resolved.timeout_ms === undefined ? {} : { timeout_ms: resolved.timeout_ms }),
  });
}

export async function run_http_server_checks(
  state: EvalTaskState,
  input: {
    server: EvalCommandSpec;
    checks: EvalHttpCheckSpec[];
    port?: number;
    ready_timeout_ms?: number;
    request_timeout_ms?: number;
  },
): Promise<SessionEnvCommandResult> {
  const port = input.port ?? allocate_eval_port();
  const variables = { PORT: String(port) };
  const server = resolve_command_spec(input.server, variables);
  const pid_path = `tmp/${state.run_id}/http-server.pid`;
  const log_path = `logs/${safe_file_part(state.task.task_id)}-${state.attempt_index}.server.log`;
  const ready_timeout_ms = input.ready_timeout_ms ?? 30_000;
  const request_timeout_ms = input.request_timeout_ms ?? 2_000;

  await start_workspace_server(state, {
    server,
    pid_path,
    log_path,
  });

  try {
    const checks = input.checks.map((check) => ({
      ...check,
      url: replace_variables(check.url, variables),
    }));
    const result = await wait_for_http_checks(state, {
      checks,
      ready_timeout_ms,
      request_timeout_ms,
    });
    if (result.exit_code === 0) return result;

    const log = await read_workspace_text_or_empty(state, log_path);
    return {
      ...result,
      stderr: [result.stderr, log ? `server log:\n${log}` : ''].filter(Boolean).join('\n'),
    };
  } finally {
    await stop_workspace_server(state, pid_path);
  }
}

function resolve_command_spec(
  command: EvalCommandSpec,
  variables: CommandVariables,
): EvalCommandSpec {
  return {
    command: replace_variables(command.command, variables),
    ...(command.args === undefined
      ? {}
      : { args: command.args.map((arg) => replace_variables(arg, variables)) }),
    ...(command.cwd === undefined ? {} : { cwd: replace_variables(command.cwd, variables) }),
    ...(command.timeout_ms === undefined ? {} : { timeout_ms: command.timeout_ms }),
    ...(command.env === undefined ? {} : { env: resolve_env(command.env, variables) }),
  };
}

function resolve_env(env: Record<string, string>, variables: CommandVariables) {
  return Object.fromEntries(
    Object.entries(env).map(([key, value]) => [key, replace_variables(value, variables)]),
  );
}

async function start_workspace_server(
  state: EvalTaskState,
  input: { server: EvalCommandSpec; pid_path: string; log_path: string },
) {
  const pid_directory = input.pid_path.split('/').slice(0, -1).join('/');
  const server_command = [
    ...Object.entries(input.server.env ?? {}).map(
      ([key, value]) => `${key}=${shell_escape(value)}`,
    ),
    shell_escape(input.server.command),
    ...(input.server.args ?? []).map(shell_escape),
  ].join(' ');
  const start_script = [
    'mkdir -p "$HOME/logs" "$HOME/tmp"',
    `mkdir -p "$HOME/${pid_directory}"`,
    `${server_command} > "$HOME/${input.log_path}" 2>&1 & echo $! > "$HOME/${input.pid_path}"`,
  ].join(' && ');

  const result = await run_workspace_command(state, {
    command: 'sh',
    args: ['-c', start_script],
    cwd: input.server.cwd ?? 'repo',
    timeout_ms: 5_000,
  });
  if (result.exit_code !== 0) {
    throw new Error(`server start failed: ${join_command_output(result)}`);
  }
}

async function wait_for_http_checks(
  state: EvalTaskState,
  input: {
    checks: EvalHttpCheckSpec[];
    ready_timeout_ms: number;
    request_timeout_ms: number;
  },
) {
  return run_workspace_command(state, {
    command: 'node',
    args: [
      '-e',
      http_check_script,
      JSON.stringify(input.checks),
      String(input.ready_timeout_ms),
      String(input.request_timeout_ms),
    ],
    cwd: 'repo',
    timeout_ms: input.ready_timeout_ms + 5_000,
  });
}

async function stop_workspace_server(state: EvalTaskState, pid_path: string) {
  await run_workspace_command(state, {
    command: 'sh',
    args: [
      '-c',
      [
        `if test -f "$HOME/${pid_path}"; then`,
        `kill "$(cat "$HOME/${pid_path}")" >/dev/null 2>&1 || true;`,
        `rm -f "$HOME/${pid_path}";`,
        'fi',
      ].join(' '),
    ],
    cwd: 'repo',
    timeout_ms: 5_000,
  }).catch(() => undefined);
}

async function read_workspace_text_or_empty(state: EvalTaskState, workspace_path: string) {
  try {
    return (await state.workspace.environment.read?.(workspace_path)) ?? '';
  } catch {
    return '';
  }
}

function shell_command_with_env(command: EvalCommandSpec) {
  return [
    ...Object.entries(command.env ?? {}).map(([key, value]) => `${key}=${shell_escape(value)}`),
    shell_escape(command.command),
    ...(command.args ?? []).map(shell_escape),
  ].join(' ');
}

export function join_command_output(result: SessionEnvCommandResult) {
  return [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n').slice(0, 4000);
}

function replace_variables(value: string, variables: CommandVariables) {
  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (match, key: string) => variables[key] ?? match);
}

function allocate_eval_port() {
  return 41_000 + Math.floor(Math.random() * 10_000);
}

function safe_file_part(value: string) {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '-').toLowerCase();
}

function shell_escape(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

const http_check_script = `
const checks = JSON.parse(process.argv[1]);
const readyTimeoutMs = Number(process.argv[2]);
const requestTimeoutMs = Number(process.argv[3]);
const deadline = Date.now() + readyTimeoutMs;
let lastError = '';

async function checkOnce() {
  for (const check of checks) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetch(check.url, { signal: controller.signal });
      const body = await response.text();
      const expectedStatus = check.status ?? 200;
      if (response.status !== expectedStatus) {
        throw new Error(check.url + ' returned ' + response.status + ', expected ' + expectedStatus);
      }
      if (check.contains && !body.includes(check.contains)) {
        throw new Error(check.url + ' did not contain ' + JSON.stringify(check.contains));
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}

while (Date.now() < deadline) {
  try {
    await checkOnce();
    process.stdout.write('http checks passed');
    process.exit(0);
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

console.error(lastError || 'http checks timed out');
process.exit(1);
`;
