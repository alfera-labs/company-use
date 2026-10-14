import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { env } from '@coworker/config';
import { AppError } from '@coworker/shared';
import {
  e2b_workspace_root,
  quote_shell_argument,
} from '@runtime-platform/orchestrator/e2b_command';
import { run_with_e2b_write_ownership } from '@runtime-platform/orchestrator/e2b_write_ownership';
import { Sandbox, SandboxNotFoundError } from 'e2b';

export async function replace_e2b_workspace_bytes(input: {
  provider_sandbox_id: string;
  volume_root_path: string;
  volume_workspace_path: string;
  file_path: string;
  data: Uint8Array;
  expected_version: string;
  content_version: string;
}) {
  let sandbox: Awaited<ReturnType<typeof Sandbox.connect>>;
  try {
    sandbox = await Sandbox.connect(input.provider_sandbox_id, {
      timeoutMs: env.COWORKER_E2B_TIMEOUT_MS,
    });
  } catch (error) {
    if (error instanceof SandboxNotFoundError) return false;
    throw error;
  }
  const ownership_path = path.posix.join(e2b_workspace_root, input.file_path);
  const parent_path = path.posix.dirname(ownership_path);
  const target_path = path.posix.join(
    input.volume_root_path,
    input.volume_workspace_path,
    input.file_path,
  );
  const staged_path = `/tmp/alfera-file-save-${randomUUID()}`;
  await sandbox.files.write(staged_path, Uint8Array.from(input.data).buffer);
  let mutation_error: unknown;
  try {
    await run_with_e2b_write_ownership(
      sandbox,
      { root_path: input.volume_root_path },
      input.volume_workspace_path,
      [parent_path],
      async () => {
        await validate_owned_target(sandbox, target_path, input);
        return replace_owned_file(sandbox, { ...input, target_path, staged_path });
      },
      { checkout_wait: { attempts: 1, delay_ms: 0 } },
    );
  } catch (error) {
    mutation_error = error;
  }
  try {
    await sandbox.files.remove(staged_path);
  } catch (cleanup_error) {
    if (mutation_error instanceof AppError && mutation_error.status === 409) {
      console.error('Failed to remove the staged workspace file after a conflict.', cleanup_error);
    } else if (mutation_error) {
      throw new AggregateError([mutation_error, cleanup_error], 'The workspace file save failed.');
    } else {
      throw cleanup_error;
    }
  }
  if (mutation_error) throw mutation_error;
  return true;
}

async function validate_owned_target(
  sandbox: Awaited<ReturnType<typeof Sandbox.connect>>,
  target_path: string,
  input: { volume_root_path: string; volume_workspace_path: string },
) {
  const workspace_root = path.posix.join(input.volume_root_path, input.volume_workspace_path);
  const command = [
    'set -eu',
    `resolved=$(readlink -f -- ${quote_shell_argument(target_path)})`,
    `test "$resolved" = ${quote_shell_argument(target_path)}`,
    `case "$resolved/" in ${quote_shell_argument(`${workspace_root}/`)}*) ;; *) exit 64 ;; esac`,
  ].join('\n');
  const result = await sandbox.commands.run(command, { user: 'root' });
  if (result.exitCode !== 0)
    throw new AppError('workspace_path_invalid', 'The file leaves the workspace.', 400);
}

async function replace_owned_file(
  sandbox: Awaited<ReturnType<typeof Sandbox.connect>>,
  input: {
    target_path: string;
    staged_path: string;
    expected_version: string;
    content_version: string;
  },
) {
  const current = await sandbox.files.read(input.target_path, { format: 'bytes' });
  const actual_version = createHash('sha256').update(current).digest('hex');
  if (actual_version !== input.expected_version) {
    throw new AppError(
      'workspace_file_version_conflict',
      'This file changed after you opened it. Reload it before you save again.',
      409,
      { content_version: actual_version },
    );
  }
  const staged = await sandbox.files.read(input.staged_path, { format: 'bytes' });
  if (createHash('sha256').update(staged).digest('hex') !== input.content_version) {
    throw new Error('Staged content hash mismatch.');
  }
  const target = quote_shell_argument(input.target_path);
  const staged_path = quote_shell_argument(input.staged_path);
  const history = quote_shell_argument(
    `${path.posix.dirname(input.target_path)}/.alfera-revisions/${path.posix.basename(input.target_path)}/${input.expected_version}`,
  );
  const history_root = quote_shell_argument(
    `${path.posix.dirname(input.target_path)}/.alfera-revisions`,
  );
  const file_history = quote_shell_argument(
    `${path.posix.dirname(input.target_path)}/.alfera-revisions/${path.posix.basename(input.target_path)}`,
  );
  const temporary = quote_shell_argument(`${input.target_path}.alfera-${randomUUID()}`);
  const command = [
    'set -eu',
    `cleanup() { rm -f -- ${temporary}; }`,
    'trap cleanup EXIT',
    `if [ -e ${history_root} ] && [ "$(readlink -f -- ${history_root})" != ${history_root} ]; then exit 44; fi`,
    `if [ -e ${file_history} ] && [ "$(readlink -f -- ${file_history})" != ${file_history} ]; then exit 44; fi`,
    `mkdir -p -- "$(dirname -- ${history})"`,
    `if [ ! -e ${history} ]; then cp -p -- ${target} ${history}; sync -f ${history}; fi`,
    `cp -- ${staged_path} ${temporary}`,
    `chmod --reference=${target} ${temporary}`,
    `chown --reference=${target} ${temporary}`,
    `sync -f ${temporary}`,
    `mv -- ${temporary} ${target}`,
    `sync -f ${target}`,
  ].join('\n');
  const result = await sandbox.commands.run(command, { user: 'root' });
  if (result.exitCode !== 0) throw new Error(result.stderr || 'E2B atomic replacement failed.');
}
