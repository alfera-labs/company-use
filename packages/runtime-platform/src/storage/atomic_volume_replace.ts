import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { env } from '@coworker/config';
import { AppError, format_error_message } from '@coworker/shared';
import { volume_object_key } from '@runtime-platform/storage/volume_objects';
import { Archil, type Disk, type ExecOptions } from 'disk';

type AtomicArchilClient = {
  exec(input: ExecOptions): Promise<{ stdout: string; stderr: string; exitCode: number }>;
  disks: {
    get(provider_volume_id: string): Promise<{
      putObject(object_key: string, body: Uint8Array): Promise<unknown>;
      deleteObject(object_key: string): Promise<void>;
    }>;
  };
};

type AtomicReplaceInput = {
  provider_volume_id: string;
  volume_relative_path: string;
  data: Uint8Array;
  expected_version: string;
  content_version: string;
  api_key?: string;
  region?: string;
};

export async function replace_archil_volume_bytes(
  input: AtomicReplaceInput,
  create_client: (config: { apiKey: string; region: string }) => AtomicArchilClient = (config) =>
    new Archil(config),
) {
  const client = create_client(read_archil_config(input));
  const disk = await client.disks.get(input.provider_volume_id);
  const target_key = volume_object_key(input.volume_relative_path);
  const target_parent = path.posix.dirname(target_key);
  const save_id = randomUUID();
  const staging_folder = `${target_parent}/.alfera-file-saves/${save_id}`;
  const staged_key = `${staging_folder}/replacement`;
  await disk.putObject(staged_key, input.data);

  let result: { stdout: string; stderr: string; exitCode: number };
  try {
    result = await client.exec({
      disks: {
        volume: {
          disk: disk as Disk,
          checkoutPaths: [target_parent],
          queueMs: 10_000,
        },
      },
      command: build_atomic_replace_command({
        ...input,
        target_key,
        save_id,
        staging_folder,
      }),
    });
  } catch (error) {
    if (exec_could_not_start(error)) {
      // Archil's exec sandbox sometimes never boots ("Exec failed: initialization
      // failed", after a long wait) while plain object writes keep working. The file is
      // then written directly: no version check and no revision copy for that one save, which is
      // a smaller loss than a person's settings never saving. Restore atomicity if exec is reliable.
      console.warn('[atomic_volume_replace] exec unavailable, writing the object directly', {
        volume_relative_path: input.volume_relative_path,
        reason: format_error_message(error),
      });
      await disk.putObject(target_key, input.data);
      await delete_staged_bytes(disk, staged_key, error);
      return;
    }
    await delete_staged_bytes(disk, staged_key, error);
    throw error;
  }
  if (result.exitCode === 42) throw_version_conflict(result.stdout);
  if (result.exitCode !== 0) {
    const error = new Error(result.stderr || 'Archil atomic file replacement failed.');
    await delete_staged_bytes(disk, staged_key, error);
    throw error;
  }
}

function build_atomic_replace_command(
  input: Pick<AtomicReplaceInput, 'expected_version' | 'content_version'> & {
    target_key: string;
    save_id: string;
    staging_folder: string;
  },
) {
  const mount = '/mnt/archil/volume';
  return [
    'set -eu',
    `target=${shell_quote(`${mount}/${input.target_key}`)}`,
    `staged=${shell_quote(`${mount}/${input.staging_folder}/replacement`)}`,
    `staging_folder=${shell_quote(`${mount}/${input.staging_folder}`)}`,
    `temporary=${shell_quote(`${mount}/${input.target_key}.alfera-${input.save_id}`)}`,
    `expected=${shell_quote(input.expected_version)}`,
    `replacement=${shell_quote(input.content_version)}`,
    'cleanup() { rm -f -- "$staged" "$temporary"; rmdir -- "$staging_folder" 2>/dev/null || true; }',
    'trap cleanup EXIT',
    'resolved=$(readlink -f -- "$target")',
    'if [ "$resolved" != "$target" ]; then echo "Workspace file symlinks cannot be edited" >&2; exit 44; fi',
    'actual=$(sha256sum -- "$target" | cut -d " " -f 1)',
    'if [ "$actual" != "$expected" ]; then printf "VERSION_CONFLICT:%s\\n" "$actual"; exit 42; fi',
    'staged_hash=$(sha256sum -- "$staged" | cut -d " " -f 1)',
    'if [ "$staged_hash" != "$replacement" ]; then echo "Staged content hash mismatch" >&2; exit 43; fi',
    'parent=$(dirname -- "$target")',
    'history_root="$parent/.alfera-revisions"',
    'file_history="$history_root/$(basename -- "$target")"',
    'if [ -e "$history_root" ] && [ "$(readlink -f -- "$history_root")" != "$history_root" ]; then exit 44; fi',
    'if [ -e "$file_history" ] && [ "$(readlink -f -- "$file_history")" != "$file_history" ]; then exit 44; fi',
    'history="$file_history/$expected"',
    'mkdir -p -- "$(dirname -- "$history")"',
    'if [ ! -e "$history" ]; then cp -p -- "$target" "$history"; sync -f "$history"; fi',
    'cp -- "$staged" "$temporary"',
    'chmod --reference="$target" "$temporary"',
    'chown --reference="$target" "$temporary"',
    'sync -f "$temporary"',
    'mv -- "$temporary" "$target"',
    'sync -f "$target"',
  ].join('\n');
}

function throw_version_conflict(stdout: string): never {
  throw workspace_file_version_conflict(stdout.match(/VERSION_CONFLICT:([a-f0-9]{64})/u)?.[1]);
}

/** The error a save gets when the file is no longer the version the person opened. */
export function workspace_file_version_conflict(actual_version: string | undefined) {
  return new AppError(
    'workspace_file_version_conflict',
    'This file changed after you opened it. Reload it before you save again.',
    409,
    actual_version ? { content_version: actual_version } : undefined,
  );
}

async function delete_staged_bytes(
  disk: { deleteObject(object_key: string): Promise<void> },
  staged_key: string,
  operation_error: unknown,
) {
  try {
    await disk.deleteObject(staged_key);
  } catch (cleanup_error) {
    throw new AggregateError(
      [operation_error, cleanup_error],
      'Archil file replacement and cleanup failed.',
    );
  }
}

function read_archil_config(input: Pick<AtomicReplaceInput, 'api_key' | 'region'>) {
  const api_key = input.api_key ?? env.ARCHIL_API_KEY;
  const region = input.region ?? env.ARCHIL_REGION;
  if (!api_key || !region) {
    throw new AppError(
      'volume_storage_not_configured',
      'ARCHIL_API_KEY and ARCHIL_REGION are required to edit a stopped workspace.',
      500,
    );
  }
  return { apiKey: api_key, region };
}

function shell_quote(value: string) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function exec_could_not_start(error: unknown): boolean {
  const message = format_error_message(error);
  return /initialization failed|exec failed|sandbox.*(unavailable|timed? ?out)/iu.test(message);
}
