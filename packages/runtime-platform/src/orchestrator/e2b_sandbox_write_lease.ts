import { randomUUID } from 'node:crypto';
import {
  create_logger,
  format_error_message,
  run_after_earlier_runs,
  sleep,
} from '@coworker/shared';
import { join_shell_command } from '@runtime-platform/orchestrator/e2b_command';
import {
  command_failure_detail,
  run_sandbox_command,
} from '@runtime-platform/orchestrator/e2b_volume';
import type { Sandbox } from 'e2b';

type E2bSandbox = Awaited<ReturnType<typeof Sandbox.create>>;

const log = create_logger('e2b_sandbox_write_lease');

export const sandbox_write_lease_file = '/var/lock/alfera/durable-write.lease';
const lease_seconds = 60;
const renew_every_ms = 20_000;
const claim_retry_ms = 250;
const claim_give_up_ms = 30_000;
const held_by_another_writer_exit_code = 75;

const lease_script = [
  'lease_file=$1 token=$2 seconds=$3 action=$4',
  'mkdir -p "$(dirname "$lease_file")"',
  'exec 9>"$lease_file.guard"',
  'flock 9',
  'now=$(date +%s) holder= expiry=0',
  '[ -s "$lease_file" ] && read -r holder expiry < "$lease_file"',
  'if [ "$action" = release ]; then',
  '  if [ "$holder" = "$token" ]; then rm -f "$lease_file"; fi',
  '  exit 0',
  'fi',
  `if [ -n "$holder" ] && [ "$holder" != "$token" ] && [ "$expiry" -gt "$now" ]; then exit ${held_by_another_writer_exit_code}; fi`,
  'echo "$token $((now + seconds))" > "$lease_file"',
].join('\n');

/**
 * Runs durable writes in one sandbox one at a time. Writers in this process wait in memory. Writers
 * in other processes (the API saving a file while a run writes) meet at a lease file inside the
 * sandbox itself, claimed in one short command and released in another, so no writer holds a
 * database connection while the sandbox works. A lease left by a crashed writer expires on its
 * own, and a live writer renews its lease while its work runs.
 */
export function run_with_sandbox_write_lease<T>(
  sandbox: E2bSandbox,
  work: () => Promise<T>,
): Promise<T> {
  return run_after_earlier_runs(`e2b_sandbox_write:${sandbox.sandboxId}`, async () => {
    const token = randomUUID();
    await claim_sandbox_write_lease(sandbox, token);
    const renewal = setInterval(() => {
      void renew_sandbox_write_lease(sandbox, token);
    }, renew_every_ms);
    renewal.unref?.();
    try {
      return await work();
    } finally {
      clearInterval(renewal);
      await release_sandbox_write_lease(sandbox, token);
    }
  });
}

async function claim_sandbox_write_lease(
  sandbox: E2bSandbox,
  token: string,
  give_up_time = Date.now() + claim_give_up_ms,
): Promise<void> {
  const result = await run_lease_command(sandbox, token, 'claim');
  if (result.exit_code === 0) return;
  if (result.exit_code !== held_by_another_writer_exit_code) {
    throw new Error(`Claiming the sandbox write lease failed: ${command_failure_detail(result)}`);
  }
  if (Date.now() >= give_up_time) {
    throw new Error(
      `Another writer held the sandbox write lease for more than ${claim_give_up_ms} ms.`,
    );
  }
  await sleep(claim_retry_ms);
  return claim_sandbox_write_lease(sandbox, token, give_up_time);
}

async function renew_sandbox_write_lease(sandbox: E2bSandbox, token: string) {
  const result = await run_lease_command_reporting_errors(sandbox, token, 'claim');
  if (result.exit_code === 0) return;
  log.warn('Renewing the sandbox write lease failed.', {
    sandbox_id: sandbox.sandboxId,
    detail: command_failure_detail(result),
  });
}

async function release_sandbox_write_lease(sandbox: E2bSandbox, token: string) {
  const result = await run_lease_command_reporting_errors(sandbox, token, 'release');
  if (result.exit_code === 0) return;
  log.warn('Releasing the sandbox write lease failed. It expires on its own.', {
    sandbox_id: sandbox.sandboxId,
    detail: command_failure_detail(result),
  });
}

function run_lease_command_reporting_errors(
  sandbox: E2bSandbox,
  token: string,
  action: 'claim' | 'release',
) {
  return run_lease_command(sandbox, token, action).catch((error: unknown) => ({
    exit_code: -1,
    stdout: '',
    stderr: format_error_message(error),
  }));
}

function run_lease_command(sandbox: E2bSandbox, token: string, action: 'claim' | 'release') {
  return run_sandbox_command(
    sandbox,
    join_shell_command([
      'sh',
      '-c',
      lease_script,
      'sh',
      sandbox_write_lease_file,
      token,
      String(lease_seconds),
      action,
    ]),
    { timeoutMs: 30_000, user: 'root' },
  );
}
