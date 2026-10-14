import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { env } from '@coworker/config';
import {
  create_local_disk_object_storage,
  type LocalDiskObjectStorage,
  StoredObjectSizeError,
} from '@runtime-platform/files/local_disk_object_storage';
import {
  open_file_object_storage,
  set_memory_import_object_storage_for_tests,
} from '@runtime-platform/files/object_storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const original_env = {
  ARTIFACT_UPLOAD_BUCKET: env.ARTIFACT_UPLOAD_BUCKET,
  COWORKER_FILE_STORAGE_PATH: env.COWORKER_FILE_STORAGE_PATH,
};
const text = (value: string) => new TextEncoder().encode(value);
let root_directory: string;
let storage: LocalDiskObjectStorage;

beforeEach(async () => {
  root_directory = await mkdtemp(path.join(tmpdir(), 'local-disk-storage-'));
  storage = create_local_disk_object_storage({
    root_directory,
    bucket_folder: 'ARTIFACT_UPLOAD_BUCKET',
  });
});

afterEach(async () => {
  Object.assign(env, original_env);
  set_memory_import_object_storage_for_tests(undefined);
  await rm(root_directory, { recursive: true, force: true });
});

async function text_of(stream: ReadableStream<Uint8Array>) {
  return new Response(stream).text();
}

describe('local disk object storage', () => {
  it('stores an object once and reads it back with its content type', async () => {
    const object = { object_key: 'workspace/ws_1/files/a/notes.txt', content_type: 'text/plain' };

    expect(await storage.put_if_absent({ ...object, data: text('first') })).toEqual({
      created: true,
    });
    expect(await storage.put_if_absent({ ...object, data: text('second') })).toEqual({
      created: false,
    });

    expect(new TextDecoder().decode(await storage.read(object.object_key))).toBe('first');
    expect(await text_of(await storage.open_stream(object.object_key))).toBe('first');
    expect(await storage.describe(object.object_key)).toMatchObject({
      byte_size: 5,
      content_type: 'text/plain',
    });
  });

  it('lets exactly one of many concurrent writers create the object', async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        storage.put_if_absent({
          object_key: 'workspace/ws_1/race.txt',
          data: text(`writer-${index}`),
          content_type: 'text/plain',
        }),
      ),
    );

    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(await readdir(path.join(root_directory, 'ARTIFACT_UPLOAD_BUCKET', 'incoming'))).toEqual(
      [],
    );
  });

  it('describes a missing object as null and refuses to read it', async () => {
    expect(await storage.describe('workspace/ws_1/missing.txt')).toBeNull();
    await expect(storage.read('workspace/ws_1/missing.txt')).rejects.toThrow(/not found/);
    await expect(storage.open_stream('workspace/ws_1/missing.txt')).rejects.toThrow(/not found/);
  });

  it('deletes the bytes and the content type, and deleting twice is fine', async () => {
    const object_key = 'workspace/ws_1/files/a/gone.txt';
    await storage.put_if_absent({ object_key, data: text('x'), content_type: 'text/plain' });

    await storage.delete(object_key);
    await storage.delete(object_key);

    expect(await storage.describe(object_key)).toBeNull();
    expect((await storage.list_by_prefix({ object_key_prefix: '' })).objects).toEqual([]);
    expect(
      await storage.put_if_absent({ object_key, data: text('y'), content_type: 'a/b' }),
    ).toEqual({ created: true });
    expect((await storage.describe(object_key))?.content_type).toBe('a/b');
  });

  it('lists only the keys under a prefix, sorted, in one page', async () => {
    expect(await storage.list_by_prefix({ object_key_prefix: '' })).toEqual({
      objects: [],
      next_page_token: null,
    });
    const keys = ['workspace/ws_2/b.txt', 'workspace/ws_1/z/deep.txt', 'workspace/ws_1/a.txt'];
    await Promise.all(
      keys.map((object_key) =>
        storage.put_if_absent({ object_key, data: text(object_key), content_type: 'text/plain' }),
      ),
    );

    const page = await storage.list_by_prefix({ object_key_prefix: 'workspace/ws_1/' });

    expect(page.next_page_token).toBeNull();
    expect(page.objects.map((object) => object.object_key)).toEqual([
      'workspace/ws_1/a.txt',
      'workspace/ws_1/z/deep.txt',
    ]);
    expect(page.objects[0]).toMatchObject({ byte_size: 'workspace/ws_1/a.txt'.length });
    expect(page.objects[0]?.entity_tag).toMatch(/^"[0-9a-f]+-[0-9a-f]+"$/);
  });

  it.each([
    '../outside.txt',
    'workspace/../../outside.txt',
    '/etc/passwd',
    'workspace/ws_1/../../../outside.txt',
    'workspace/./a.txt',
    'workspace//a.txt',
    'workspace/a.txt/',
    'workspace\\..\\outside.txt',
    'workspace/a\0.txt',
    '..',
    '',
  ])('refuses the key %j in every operation', async (object_key) => {
    await writeFile(path.join(root_directory, 'outside.txt'), 'secret');
    const refusal = /not a path inside the storage/;
    const stream = new Blob(['x']).stream();

    await expect(
      storage.put_if_absent({ object_key, data: text('x'), content_type: 'text/plain' }),
    ).rejects.toThrow(refusal);
    await expect(
      storage.write_stream({ object_key, content_type: 'text/plain', byte_size: 1, stream }),
    ).rejects.toThrow(refusal);
    await expect(storage.read(object_key)).rejects.toThrow(refusal);
    await expect(storage.open_stream(object_key)).rejects.toThrow(refusal);
    await expect(storage.describe(object_key)).rejects.toThrow(refusal);
    await expect(storage.delete(object_key)).rejects.toThrow(refusal);
    expect(await readdir(root_directory)).toEqual(['outside.txt']);
    expect(await readFile(path.join(root_directory, 'outside.txt'), 'utf8')).toBe('secret');
  });

  it('streams an upload to disk and replaces what was there', async () => {
    const object = {
      object_key: 'workspace/ws_1/files/a/deck.pdf',
      content_type: 'application/pdf',
    };
    await storage.write_stream({ ...object, byte_size: 3, stream: new Blob(['one']).stream() });
    const written = await storage.write_stream({
      ...object,
      byte_size: 5,
      stream: new Blob(['three']).stream(),
    });

    expect(written.entity_tag).toMatch(/^"[0-9a-f]+-[0-9a-f]+"$/);
    expect(await text_of(await storage.open_stream(object.object_key))).toBe('three');
    expect(await storage.describe(object.object_key)).toMatchObject({
      byte_size: 5,
      content_type: 'application/pdf',
    });
  });

  it.each([
    ['longer', 'four'],
    ['shorter', 'on'],
  ])('keeps nothing from a stream %s than the promised size', async (_case, body) => {
    const object_key = 'workspace/ws_1/files/a/wrong_size.bin';

    await expect(
      storage.write_stream({
        object_key,
        content_type: 'application/octet-stream',
        byte_size: 3,
        stream: new Blob([body]).stream(),
      }),
    ).rejects.toBeInstanceOf(StoredObjectSizeError);

    expect(await storage.describe(object_key)).toBeNull();
    expect(await readdir(path.join(root_directory, 'ARTIFACT_UPLOAD_BUCKET', 'incoming'))).toEqual(
      [],
    );
  });

  it('stops reading a stream as soon as it passes the promised size', async () => {
    const total_chunks = 400;
    let pulled_chunks = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled_chunks += 1;
        if (pulled_chunks > total_chunks) return controller.close();
        controller.enqueue(new Uint8Array(64 * 1024));
      },
    });

    await expect(
      storage.write_stream({
        object_key: 'workspace/ws_1/files/a/flood.bin',
        content_type: 'application/octet-stream',
        byte_size: 1_024,
        stream,
      }),
    ).rejects.toBeInstanceOf(StoredObjectSizeError);

    expect(pulled_chunks).toBeLessThan(total_chunks / 4);
  });

  it('keeps each bucket name in its own folder', async () => {
    const other = create_local_disk_object_storage({
      root_directory,
      bucket_folder: 'MEMORY_IMPORT_BUCKET',
    });
    const object = { object_key: 'workspace/ws_1/same.txt', content_type: 'text/plain' };
    await storage.put_if_absent({ ...object, data: text('uploads') });

    expect(await other.describe(object.object_key)).toBeNull();
    expect(await other.put_if_absent({ ...object, data: text('imports') })).toEqual({
      created: true,
    });
    expect(new TextDecoder().decode(await storage.read(object.object_key))).toBe('uploads');
  });
});

describe('open_file_object_storage with no bucket', () => {
  it('keeps the bucket error when neither a bucket nor a directory is configured', () => {
    Object.assign(env, {
      ARTIFACT_UPLOAD_BUCKET: undefined,
      COWORKER_FILE_STORAGE_PATH: undefined,
    });
    set_memory_import_object_storage_for_tests(undefined);

    expect(() => open_file_object_storage('object_store')).toThrow(
      'ARTIFACT_UPLOAD_BUCKET is required to read or write artifact bytes',
    );
  });

  it('stores on local disk when only the directory is configured', async () => {
    Object.assign(env, {
      ARTIFACT_UPLOAD_BUCKET: undefined,
      COWORKER_FILE_STORAGE_PATH: root_directory,
    });
    set_memory_import_object_storage_for_tests(undefined);

    await open_file_object_storage('object_store').put_if_absent({
      object_key: 'workspace/ws_1/selected.txt',
      data: text('local'),
      content_type: 'text/plain',
    });

    expect(await storage.describe('workspace/ws_1/selected.txt')).toMatchObject({ byte_size: 5 });
  });

  it('lets a configured bucket win over the directory', async () => {
    Object.assign(env, {
      ARTIFACT_UPLOAD_BUCKET: 'a-real-bucket',
      COWORKER_FILE_STORAGE_PATH: root_directory,
    });
    set_memory_import_object_storage_for_tests(undefined);

    expect(() => open_file_object_storage('object_store')).toThrow(
      'R2_BUCKET_ENDPOINT is required to read or write artifact bytes',
    );
    expect(await readdir(root_directory)).toEqual([]);
  });
});
