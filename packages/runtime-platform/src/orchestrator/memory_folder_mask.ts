import path from 'node:path';
import type { SessionEnv } from '@agent-core/environment';
import { env } from '@coworker/config';
import { create_logger } from '@coworker/shared';
import { quote_shell_argument } from '@runtime-platform/orchestrator/e2b_command';
import {
  assert_command_succeeded,
  run_sandbox_command,
} from '@runtime-platform/orchestrator/e2b_volume';
import type { WorkspaceLayout } from '@runtime-platform/storage/workspace_layouts';
import { Sandbox } from 'e2b';
import { z } from 'zod';

const log = create_logger('memory_folder_mask');

/** One company memory path to hide: a layout memory folder, or a memory file such as user.md. */
export type MemoryMaskTarget = { target_path: string; target_kind: 'folder' | 'file' };

export type MemoryMaskOutcome =
  | { mask_state: 'masked' | 'unmasked' }
  | { mask_state: 'not_supported'; environment_provider: string }
  | { mask_state: 'failed'; environment_provider: string; error_message: string };

/**
 * Every sandbox path a company memory folder/file is reachable from: the model-root view a
 * normal tool call addresses (`/workspace/people`), and the raw durable-volume path behind that
 * bind mount (`/mnt/coworker/agents/<id>/workspace/people`). The volume path stays readable to a
 * plain shell command and to any symlink planted on the volume by an earlier open run, so masking
 * the model root alone leaves the company folder readable. Both must be masked and unmasked
 * together.
 */
export type MemoryMaskRoots = { model_root: string; volume_root: string };

/** Sandbox-local tmpfs that holds the empty read-only file bound over masked memory files. */
export const memory_mask_source_directory = '/run/coworker-memory-mask';

const mask_runners: Readonly<
  Record<string, (environment: SessionEnv, script: string) => Promise<void>>
> = { e2b: run_script_as_root_in_e2b };

const e2b_mask_metadata_schema = z.object({ provider_sandbox_id: z.string().min(1) });

/** Every layout memory folder and memory file, under both the model root and the raw volume root. */
export function company_memory_mask_targets(
  layout: WorkspaceLayout,
  roots: MemoryMaskRoots,
): MemoryMaskTarget[] {
  return [roots.model_root, roots.volume_root].flatMap((root) => [
    ...layout.memory_folders.map((folder) => ({
      target_path: path.posix.join(root, folder),
      target_kind: 'folder' as const,
    })),
    ...layout.memory_files.map((file) => ({
      target_path: path.posix.join(root, file),
      target_kind: 'file' as const,
    })),
  ]);
}

/**
 * Hide each target behind an empty read-only mount in this sandbox only. Folders get a
 * read-only tmpfs; files get a read-only bind of one empty file. The volume is never written.
 * Both the model root and the raw volume root are made private first, so no mask propagates
 * into the disk mount and blocks its unmount. Idempotent: a mounted target is skipped. Run the
 * unmask script before teardown, and before the Archil unmount of the volume.
 */
export function memory_folder_mask_script(
  targets: readonly MemoryMaskTarget[],
  roots: MemoryMaskRoots,
  source_directory = memory_mask_source_directory,
) {
  const source = quote_shell_argument(source_directory);
  const empty_file = quote_shell_argument(path.posix.join(source_directory, 'empty'));
  return [
    ...mask_shell_functions,
    `mkdir -p -- ${source}`,
    `is_mounted ${source} || mount -t tmpfs -o mode=0755,size=16k coworker-memory-mask ${source}`,
    `[ -f ${empty_file} ] || : > ${empty_file}`,
    `chmod 0444 -- ${empty_file}`,
    ...[roots.model_root, roots.volume_root].map(
      (root) =>
        `if is_mounted ${quote_shell_argument(root)}; then mount --make-private ${quote_shell_argument(root)}; fi`,
    ),
    ...targets.map((target) => mask_line(target, empty_file)),
  ].join('\n');
}

/** Remove every mask the mask script mounted. Idempotent: an unmounted target is skipped. */
export function memory_folder_unmask_script(
  targets: readonly MemoryMaskTarget[],
  source_directory = memory_mask_source_directory,
) {
  return [
    ...mask_shell_functions,
    ...[...targets.map((target) => target.target_path), source_directory].map(
      (mounted_path) => `unmount_all ${quote_shell_argument(mounted_path)}`,
    ),
  ].join('\n');
}

/** Mask the company memory folders in the sandbox behind this environment. */
export function mask_company_memory_folders(
  environment: SessionEnv,
  folders: readonly MemoryMaskTarget[],
  roots: MemoryMaskRoots,
) {
  return run_mask_script(environment, memory_folder_mask_script(folders, roots), 'masked');
}

/** Lift the mask from the company memory folders in the sandbox behind this environment. */
export function unmask_company_memory_folders(
  environment: SessionEnv,
  folders: readonly MemoryMaskTarget[],
) {
  return run_mask_script(environment, memory_folder_unmask_script(folders), 'unmasked');
}

const mask_shell_functions = [
  'set -eu',
  'is_mounted() { findmnt -rn --mountpoint "$1" >/dev/null 2>&1; }',
  'unmount_all() {',
  '  for attempt in 1 2 3 4; do',
  '    if ! is_mounted "$1"; then return 0; fi',
  '    umount -- "$1"',
  '  done',
  '  echo "A mask is still mounted on $1" >&2',
  '  return 1',
  '}',
];

function mask_line(target: MemoryMaskTarget, empty_file: string) {
  const quoted = quote_shell_argument(target.target_path);
  if (target.target_kind === 'folder') {
    return `if [ -d ${quoted} ] && ! is_mounted ${quoted}; then mount -t tmpfs -o ro,mode=0555,size=4k coworker-memory-mask ${quoted}; fi`;
  }
  return `if [ -f ${quoted} ] && ! is_mounted ${quoted}; then mount --bind ${empty_file} ${quoted} && mount -o remount,bind,ro ${quoted}; fi`;
}

async function run_mask_script(
  environment: SessionEnv,
  script: string,
  mask_state: 'masked' | 'unmasked',
): Promise<MemoryMaskOutcome> {
  const environment_provider = String(environment.metadata?.environment_provider ?? 'unknown');
  const run_script = mask_runners[environment_provider];
  if (!run_script) {
    log.warn('This environment provider cannot mask company memory folders.', {
      environment_provider,
    });
    return { mask_state: 'not_supported', environment_provider };
  }
  try {
    await run_script(environment, script);
    return { mask_state };
  } catch (error) {
    const error_message = error instanceof Error ? error.message : String(error);
    log.error('The company memory folder mask script failed.', {
      environment_provider,
      error_message,
    });
    return { mask_state: 'failed', environment_provider, error_message };
  }
}

async function run_script_as_root_in_e2b(environment: SessionEnv, script: string) {
  const { provider_sandbox_id } = e2b_mask_metadata_schema.parse(environment.metadata);
  const sandbox = await Sandbox.connect(provider_sandbox_id, {
    timeoutMs: env.COWORKER_E2B_TIMEOUT_MS,
  });
  assert_command_succeeded(
    await run_sandbox_command(sandbox, script, { timeoutMs: 30_000, user: 'root' }),
    'Company memory folder mask',
  );
}
