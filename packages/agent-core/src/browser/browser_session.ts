import {
  agent_browser_binary,
  with_pointer_init_script,
} from '@agent-core/browser/agent_browser_command';
import type {
  BrowserExecOptions,
  BrowserExecResult,
  BrowserSession,
} from '@agent-core/browser/types';
import type { SessionEnv, SessionEnvExecInput } from '@agent-core/environment/session_env';

// Kept below the daemon's 30s CLI IPC read timeout so a slow page surfaces as a
// readable command timeout, not a dropped connection. 28s leaves a 2s cushion
// under that ceiling while giving heavy-SPA fills and snapshots more room to
// finish before the timeout fires.
export const default_browser_command_timeout_ms = 28_000;

type ExecCommand = NonNullable<SessionEnv['exec']>;

export type BrowserSessionOptions = {
  default_command_timeout_ms?: number;
};

export function create_browser_session(
  environment: SessionEnv,
  options: BrowserSessionOptions = {},
): BrowserSession {
  const exec = environment.exec;
  if (!exec) {
    throw new Error('The browser needs a session environment that can execute commands.');
  }
  const read_bytes = environment.read_bytes;
  const default_timeout_ms =
    options.default_command_timeout_ms ?? default_browser_command_timeout_ms;
  return {
    get id() {
      return browser_sandbox_id(environment);
    },
    exec: (argv, options) =>
      run(
        exec,
        { command: agent_browser_binary, args: with_pointer_init_script(argv) },
        default_timeout_ms,
        options,
      ),
    exec_raw: (shell, options) =>
      run(exec, { command: 'bash', args: ['-lc', shell] }, default_timeout_ms, options),
    ...(read_bytes === undefined ? {} : { read_bytes: (path: string) => read_bytes(path) }),
  };
}

function browser_sandbox_id(environment: SessionEnv): string {
  const value = environment.metadata?.provider_sandbox_id;
  return typeof value === 'string' && value.length > 0 ? value : environment.env_key;
}

async function run(
  exec: ExecCommand,
  input: Pick<SessionEnvExecInput, 'command' | 'args'>,
  default_timeout_ms: number,
  options: BrowserExecOptions = {},
): Promise<BrowserExecResult> {
  const started_at = Date.now();
  const result = await exec({
    command: input.command,
    ...(input.args === undefined ? {} : { args: input.args }),
    timeout_ms: options.timeout_ms ?? default_timeout_ms,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exit_code,
    duration_ms: Math.max(1, Date.now() - started_at),
  };
}
