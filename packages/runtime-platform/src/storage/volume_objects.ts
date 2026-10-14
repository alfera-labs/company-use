import path from 'node:path';
import { env } from '@coworker/config';
import { AppError } from '@coworker/shared';
import { Archil } from 'disk';

type ArchilObjectClient = {
  disks: {
    get(provider_volume_id: string): Promise<{
      getObject(object_key: string): Promise<Uint8Array>;
      putObject(object_key: string, body: Uint8Array): Promise<unknown>;
      deleteObject(object_key: string): Promise<void>;
      listObjects(
        prefix: string,
        options: { recursive: boolean },
      ): Promise<{
        objects: { key: string; size: number; lastModified?: Date }[];
        commonPrefixes: string[];
      }>;
    }>;
  };
};

type VolumeObjectAddress = {
  provider_volume_id: string;
  volume_relative_path: string;
  api_key?: string;
  region?: string;
};

export async function read_archil_volume_bytes(
  input: VolumeObjectAddress,
  create_client: (config: { apiKey: string; region: string }) => ArchilObjectClient = (config) =>
    new Archil(config),
) {
  const disk = await open_archil_disk(input, create_client);
  return disk.getObject(volume_object_key(input.volume_relative_path));
}

/**
 * The names of the folders directly inside one folder on the volume, without a sandbox.
 *
 * A listing and a body read are not the same request, and on Archil they do not fail together:
 * a `skills/INDEX.json` can come back cut mid-string on every read while a listing
 * of the same folder names every procedure correctly. That is what makes a listing worth
 * having as the fallback when the compiled index will not parse.
 */
export async function list_archil_volume_folders(
  input: VolumeObjectAddress,
  create_client: (config: { apiKey: string; region: string }) => ArchilObjectClient = (config) =>
    new Archil(config),
): Promise<string[]> {
  const disk = await open_archil_disk(input, create_client);
  const folder_key = volume_object_key(input.volume_relative_path);
  const listed = await disk.listObjects(`${folder_key}/`, { recursive: false });
  return listed.commonPrefixes.map((prefix) => path.posix.basename(prefix));
}

export type ListedVolumeEntry = {
  file_name: string;
  byte_size: number;
  last_modified_time: string | null;
};

/**
 * One folder of the volume, as a directory listing: the files directly inside it and the
 * names of its immediate subfolders. Non-recursive on purpose — a browse of one level must
 * not pay for the whole subtree (a folder of tool logs can hold hundreds of files).
 */
export async function list_archil_volume_entries(
  input: VolumeObjectAddress,
  create_client: (config: { apiKey: string; region: string }) => ArchilObjectClient = (config) =>
    new Archil(config),
): Promise<{ folder_names: string[]; files: ListedVolumeEntry[] }> {
  const disk = await open_archil_disk(input, create_client);
  const folder_key = volume_object_key(input.volume_relative_path);
  const listed = await disk.listObjects(`${folder_key}/`, { recursive: false });
  return {
    folder_names: listed.commonPrefixes
      .map((prefix) => path.posix.basename(prefix))
      .filter(is_browsable_folder_name),
    files: listed.objects
      .filter((object) => !object.key.endsWith('/'))
      .filter((object) => is_browsable_file_name(path.posix.basename(object.key)))
      .map((object) => ({
        file_name: path.posix.basename(object.key),
        byte_size: object.size,
        last_modified_time: object.lastModified?.toISOString() ?? null,
      })),
  };
}

/** False for the folders a file save keeps for itself, which a browse never shows. */
export function is_browsable_folder_name(folder_name: string) {
  return folder_name !== '.alfera-revisions' && folder_name !== '.alfera-file-saves';
}

/** False for the half-written copy a file save leaves beside its target. */
export function is_browsable_file_name(file_name: string) {
  return !/\.alfera-[0-9a-f-]{36}$/u.test(file_name);
}

export async function write_archil_volume_bytes(
  input: VolumeObjectAddress & { data: Uint8Array },
  create_client: (config: { apiKey: string; region: string }) => ArchilObjectClient = (config) =>
    new Archil(config),
): Promise<void> {
  const disk = await open_archil_disk(input, create_client);
  await disk.putObject(volume_object_key(input.volume_relative_path), input.data);
}

async function open_archil_disk(
  input: VolumeObjectAddress,
  create_client: (config: { apiKey: string; region: string }) => ArchilObjectClient,
) {
  const client = create_archil_client(input, create_client);
  return client.disks.get(input.provider_volume_id);
}

function create_archil_client<T extends ArchilObjectClient>(
  input: VolumeObjectAddress,
  create_client: (config: { apiKey: string; region: string }) => T,
) {
  const api_key = input.api_key ?? env.ARCHIL_API_KEY;
  const region = input.region ?? env.ARCHIL_REGION;
  if (!api_key || !region) {
    throw new AppError(
      'volume_storage_not_configured',
      'ARCHIL_API_KEY and ARCHIL_REGION are required to read a stopped workspace.',
      500,
    );
  }
  return create_client({ apiKey: api_key, region });
}

function contained_relative_path(label: string, candidate: string) {
  if (candidate.startsWith('/')) throw new Error(`${label} must be relative.`);
  // normalize keeps a trailing slash, and a key ending in `/` never matches an object — a
  // folder path pasted as `skills/` would list as empty instead of as the folder.
  const normalized = path.posix.normalize(candidate).replace(/\/+$/u, '');
  if (
    normalized === '.' ||
    normalized === '' ||
    normalized === '..' ||
    normalized.startsWith('../')
  ) {
    throw new Error(`${label} escapes the workspace.`);
  }
  return normalized;
}

/** The object key for a path already relative to the volume root. */
export function volume_object_key(volume_relative_path: string) {
  return contained_relative_path('Volume object path', volume_relative_path);
}

/**
 * The object key for a file inside an agent workspace, given where that workspace sits on the
 * volume. Both halves are checked separately, so a workspace path cannot climb out of its own
 * workspace and read a sibling agent's files.
 */
export function workspace_object_key(volume_workspace_path: string, workspace_path: string) {
  return volume_object_key(
    path.posix.join(
      volume_object_key(volume_workspace_path),
      contained_relative_path('Workspace object path', workspace_path),
    ),
  );
}
