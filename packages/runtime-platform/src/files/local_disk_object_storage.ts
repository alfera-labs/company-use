import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, type Stats } from 'node:fs';
import { link, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { env } from '@coworker/config';
import type { BucketEnvName } from '@runtime-platform/files/file_storage_locations';
import { create_local_file_url } from '@runtime-platform/files/local_file_ticket';
import type { ListedObject, ObjectStorage } from '@runtime-platform/files/object_storage';

type StoredObject = { object_key: string; content_type: string };
type StreamedObject = StoredObject & { byte_size: number; stream: ReadableStream<Uint8Array> };

export type LocalDiskObjectStorage = ObjectStorage & {
  write_stream: (object: StreamedObject) => Promise<{ entity_tag: string }>;
};

export class StoredObjectSizeError extends Error {
  constructor(
    readonly expected_bytes: number,
    readonly received_bytes: number,
  ) {
    super(`The file must be exactly ${expected_bytes} bytes`);
  }
}

type BucketFolders = { objects: string; content_types: string; incoming: string };

/** Null when this bucket name has a real bucket, or when no local directory is configured. */
export function open_local_disk_object_storage(bucket_env_name: BucketEnvName) {
  const root_directory = env.COWORKER_FILE_STORAGE_PATH;
  if (env[bucket_env_name] || !root_directory) return null;
  return create_local_disk_object_storage({ root_directory, bucket_folder: bucket_env_name });
}

export function create_local_disk_object_storage(input: {
  root_directory: string;
  bucket_folder: BucketEnvName;
}): LocalDiskObjectStorage {
  const { bucket_folder } = input;
  const bucket_directory = resolve(input.root_directory, bucket_folder);
  const folders: BucketFolders = {
    objects: join(bucket_directory, 'objects'),
    content_types: join(bucket_directory, 'content_types'),
    incoming: join(bucket_directory, 'incoming'),
  };
  return {
    put_if_absent: (object) => put_if_absent(folders, object),
    write_stream: (object) => write_stream(folders, object),
    list_by_prefix: ({ object_key_prefix }) => list_by_prefix(folders, object_key_prefix),
    read: async (object_key) =>
      new Uint8Array(await readFile(await file_path(folders, object_key))),
    open_stream: async (object_key) =>
      Readable.toWeb(
        createReadStream(await file_path(folders, object_key)),
      ) as ReadableStream<Uint8Array>,
    describe: (object_key) => describe_object(folders, object_key),
    delete: async (object_key) => {
      await rm(path_inside(folders.objects, object_key), { force: true });
      await rm(path_inside(folders.content_types, object_key), { force: true });
    },
    create_presigned_put_url: async (upload) =>
      create_local_file_url({ operation: 'put', bucket_folder, ...upload }),
    create_presigned_get_url: async ({ mime_type, ...download }) =>
      create_local_file_url({
        operation: 'get',
        bucket_folder,
        content_type: mime_type,
        ...download,
      }),
  };
}

// One object is one file at its key, so `a` and `a/b` cannot both exist as they can
// in a bucket. Store objects under a hash of the key if a caller ever needs both.
function path_inside(directory: string, object_key: string) {
  const segments = object_key.split('/');
  const escapes_the_directory =
    /[\0\\]/u.test(object_key) ||
    segments.some((segment) => segment === '' || segment === '.' || segment === '..');
  if (escapes_the_directory) {
    throw new Error(`Object key ${JSON.stringify(object_key)} is not a path inside the storage`);
  }
  return join(directory, ...segments);
}

async function file_path(folders: BucketFolders, object_key: string) {
  const object_path = path_inside(folders.objects, object_key);
  if (!(await file_stats(object_path))) throw new Error(`Object ${object_key} not found`);
  return object_path;
}

async function file_stats(path: string): Promise<Stats | null> {
  try {
    const stats = await stat(path);
    return stats.isFile() ? stats : null;
  } catch (error) {
    if (is_file_error(error, 'ENOENT', 'ENOTDIR')) return null;
    throw error;
  }
}

function is_file_error(error: unknown, ...codes: string[]) {
  return error instanceof Error && 'code' in error && codes.includes(String(error.code));
}

function entity_tag_of(stats: Stats) {
  return `"${stats.size.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}"`;
}

async function describe_object(folders: BucketFolders, object_key: string) {
  const stats = await file_stats(path_inside(folders.objects, object_key));
  if (!stats) return null;
  const content_type_path = path_inside(folders.content_types, object_key);
  const has_content_type = Boolean(await file_stats(content_type_path));
  return {
    byte_size: stats.size,
    content_type: has_content_type ? await readFile(content_type_path, 'utf8') : null,
    entity_tag: entity_tag_of(stats),
  };
}

// The content type is written after the bytes are published, so a crash between the
// two leaves an object that describes itself with no content type. Callers already fall back.
async function write_content_type(folders: BucketFolders, object: StoredObject) {
  const content_type_path = path_inside(folders.content_types, object.object_key);
  await mkdir(dirname(content_type_path), { recursive: true });
  await writeFile(content_type_path, object.content_type);
}

async function paths_for_write(folders: BucketFolders, object_key: string) {
  const object_path = path_inside(folders.objects, object_key);
  await mkdir(folders.incoming, { recursive: true });
  await mkdir(dirname(object_path), { recursive: true });
  return { object_path, incoming_path: join(folders.incoming, randomUUID()) };
}

async function put_if_absent(folders: BucketFolders, object: StoredObject & { data: Uint8Array }) {
  const { object_path, incoming_path } = await paths_for_write(folders, object.object_key);
  await writeFile(incoming_path, object.data);
  try {
    await link(incoming_path, object_path);
  } catch (error) {
    if (is_file_error(error, 'EEXIST')) return { created: false };
    throw error;
  } finally {
    await rm(incoming_path, { force: true });
  }
  await write_content_type(folders, object);
  return { created: true };
}

async function write_stream(folders: BucketFolders, object: StreamedObject) {
  const { object_path, incoming_path } = await paths_for_write(folders, object.object_key);
  let received_bytes = 0;
  const size_error = () => new StoredObjectSizeError(object.byte_size, received_bytes);
  const count_bytes = new Transform({
    transform(chunk: Uint8Array, _encoding, pass_on) {
      received_bytes += chunk.byteLength;
      pass_on(received_bytes > object.byte_size ? size_error() : null, chunk);
    },
  });
  const body = Readable.fromWeb(object.stream as NodeReadableStream);
  try {
    await pipeline(body, count_bytes, createWriteStream(incoming_path, { flags: 'wx' }));
    if (received_bytes !== object.byte_size) throw size_error();
    await rename(incoming_path, object_path);
  } finally {
    await rm(incoming_path, { force: true });
  }
  await write_content_type(folders, object);
  return { entity_tag: entity_tag_of(await stat(object_path)) };
}

// Walks the whole bucket folder and returns one page. Walk only the prefix's
// directory, and page, when a folder holds enough objects for that to matter.
async function list_by_prefix(folders: BucketFolders, object_key_prefix: string) {
  await mkdir(folders.objects, { recursive: true });
  const names = await readdir(folders.objects, { recursive: true });
  const object_keys = names
    .map((name) => name.split(sep).join('/'))
    .filter((object_key) => object_key.startsWith(object_key_prefix))
    .sort();
  const listed = await Promise.all(
    object_keys.map(async (object_key): Promise<ListedObject[]> => {
      const stats = await file_stats(join(folders.objects, object_key));
      return stats ? [{ object_key, byte_size: stats.size, entity_tag: entity_tag_of(stats) }] : [];
    }),
  );
  return { objects: listed.flat(), next_page_token: null };
}
