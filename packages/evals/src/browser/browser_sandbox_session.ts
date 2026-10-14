import { create_browser_session } from '@agent-core/browser/browser_session';
import type { BrowserSession } from '@agent-core/browser/types';
import type {
  SessionEnv,
  SessionEnvCommandResult,
  SessionEnvExecInput,
} from '@agent-core/environment/session_env';
import { env } from '@coworker/config';
import { CommandExitError, Sandbox, TimeoutError } from 'e2b';

type E2bSandbox = Awaited<ReturnType<typeof Sandbox.create>>;

export function session_env_over_sandbox(sandbox: E2bSandbox): SessionEnv {
  return {
    env_key: sandbox.sandboxId,
    env_kind: 'remote_sandbox',
    metadata: { provider_sandbox_id: sandbox.sandboxId },
    exec: (input) => run_sandbox_command(sandbox, input),
    read_bytes: (path) => sandbox.files.read(path, { format: 'bytes' }),
  };
}

export async function open_browser_sandbox_session(): Promise<{
  session: BrowserSession;
  release: () => Promise<void>;
}> {
  const sandbox = await Sandbox.create(env.COWORKER_E2B_TEMPLATE_ID, {
    timeoutMs: env.COWORKER_E2B_TIMEOUT_MS,
  });
  return {
    session: create_browser_session(session_env_over_sandbox(sandbox)),
    release: async () => {
      await sandbox.kill();
    },
  };
}

async function run_sandbox_command(
  sandbox: E2bSandbox,
  input: SessionEnvExecInput,
): Promise<SessionEnvCommandResult> {
  const command = shell_join([input.command, ...(input.args ?? [])]);
  try {
    const result = await sandbox.commands.run(command, {
      timeoutMs: input.timeout_ms ?? 25_000,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    return { exit_code: result.exitCode, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    if (error instanceof CommandExitError) {
      return {
        exit_code: error.exitCode,
        stdout: error.stdout,
        stderr: error.stderr || error.error || '',
      };
    }
    if (error instanceof TimeoutError) {
      return { exit_code: 124, stdout: '', stderr: error.message, timed_out: true };
    }
    throw error;
  }
}

function shell_join(parts: string[]): string {
  return parts.map((part) => `'${part.replaceAll("'", "'\\''")}'`).join(' ');
}
