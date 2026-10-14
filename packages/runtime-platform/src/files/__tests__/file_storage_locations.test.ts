import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { create_file } from '@coworker/core/db/queries/files';
import {
  generate_file_object_key,
  is_file_object_key_inside_workspace,
} from '@runtime-platform/files/file_object_key';
import {
  file_storage_locations,
  find_file_storage_location,
  is_known_file_storage_provider,
} from '@runtime-platform/files/file_storage_locations';
import { create_in_memory_object_storage } from '@runtime-platform/files/in_memory_object_storage';
import { set_memory_import_object_storage_for_tests } from '@runtime-platform/files/object_storage';
import { open_file_bytes } from '@runtime-platform/files/open_file_bytes';
import { afterEach, describe, expect, it } from 'vitest';

const workspace_id = 'ws_file_storage';

afterEach(() => set_memory_import_object_storage_for_tests(undefined));

describe('file storage locations', () => {
  it.each(['local_workspace', 'r2', 'object_store'])('resolves the stored provider %s', (value) => {
    expect(is_known_file_storage_provider(value)).toBe(true);
    expect(find_file_storage_location(value).storage_provider).toBe(value);
  });

  it('names an unregistered provider instead of guessing', () => {
    expect(() => find_file_storage_location('dropbox')).toThrow(/not registered/);
  });

  it('keeps the legacy r2 value pointing at the memory import bucket', () => {
    expect(file_storage_locations.r2.bucket_env_name).toBe('MEMORY_IMPORT_BUCKET');
    expect(file_storage_locations.r2.browser_can_upload_here).toBe(false);
  });

  it('only lets the browser upload into the bucket that has CORS', () => {
    const browser_writable = Object.entries(file_storage_locations)
      .filter(([, location]) => location.browser_can_upload_here)
      .map(([name]) => name);
    expect(browser_writable).toEqual(['object_store']);
  });
});

describe('file object keys', () => {
  it('namespaces every key under its workspace', () => {
    const object_key = generate_file_object_key({
      workspace_id,
      file_id: 'art_123',
      file_name: 'quarterly report.pdf',
    });
    expect(object_key).toBe(`workspace/${workspace_id}/files/art_123/quarterly report.pdf`);
    expect(is_file_object_key_inside_workspace(object_key, workspace_id)).toBe(true);
    expect(is_file_object_key_inside_workspace(object_key, 'ws_other')).toBe(false);
    expect(is_file_object_key_inside_workspace(object_key, workspace_id.slice(0, 4))).toBe(false);
  });

  it('cannot be walked out of its workspace by the file name', () => {
    const object_key = generate_file_object_key({
      workspace_id,
      file_id: 'art_123',
      file_name: '../../../etc/passwd',
    });
    expect(object_key).toBe(`workspace/${workspace_id}/files/art_123/passwd`);
    expect(is_file_object_key_inside_workspace(object_key, workspace_id)).toBe(true);
  });
});

describe('workspace key roots', () => {
  it('accepts both roots that production actually stores', () => {
    expect(
      is_file_object_key_inside_workspace(
        'workspaces/ws_1/memory-imports/other_agent/sha256/a.zip',
        'ws_1',
      ),
    ).toBe(true);
    expect(is_file_object_key_inside_workspace('workspace/ws_1/files/art_1/a.pdf', 'ws_1')).toBe(
      true,
    );
  });

  it('refuses another tenant and anything unrooted', () => {
    expect(
      is_file_object_key_inside_workspace(
        'workspaces/ws_2/memory-imports/other_agent/sha256/a.zip',
        'ws_1',
      ),
    ).toBe(false);
    expect(is_file_object_key_inside_workspace('etc/passwd', 'ws_1')).toBe(false);
    expect(is_file_object_key_inside_workspace('', 'ws_1')).toBe(false);
  });
});

describe('open_file_bytes', () => {
  it('opens a file stored under the legacy r2 provider', async () => {
    const db = await create_test_database();
    const storage = create_in_memory_object_storage();
    set_memory_import_object_storage_for_tests(storage);
    const object_key = `workspaces/${workspace_id}/memory-imports/other_agent/sha256/abc.zip`;
    await storage.put_if_absent({
      object_key,
      data: new TextEncoder().encode('archive-bytes'),
      content_type: 'application/zip',
    });
    const file = await create_file(db, {
      workspace_id,
      file_purpose: 'memory_import_archive',
      storage_provider: 'r2',
      storage_key: object_key,
      file_name: 'archive.zip',
      mime_type: 'application/zip',
      actor_id: 'tester',
    });

    const opened = await open_file_bytes(db, {
      workspace_id,
      file_id: file.file_id,
      actor_id: 'tester',
    });

    expect(opened.byte_size).toBe(13);
    expect(opened.mime_type).toBe('application/zip');
  });

  it('marks a file missing when its object is gone', async () => {
    const db = await create_test_database();
    set_memory_import_object_storage_for_tests(create_in_memory_object_storage());
    const file = await create_file(db, {
      workspace_id,
      file_purpose: 'memory_import_archive',
      storage_provider: 'r2',
      storage_key: `workspaces/${workspace_id}/memory-imports/other_agent/sha256/gone.zip`,
      actor_id: 'tester',
    });

    await expect(
      open_file_bytes(db, {
        workspace_id,
        file_id: file.file_id,
        actor_id: 'tester',
      }),
    ).rejects.toThrow(/File bytes/);

    const reloaded = await db.query.files.findFirst();
    expect(reloaded?.file_status).toBe('missing');
  });

  it('refuses a file whose upload never completed', async () => {
    const db = await create_test_database();
    set_memory_import_object_storage_for_tests(create_in_memory_object_storage());
    const file = await create_file(db, {
      workspace_id,
      file_purpose: 'user_upload',
      file_status: 'pending',
      storage_provider: 'object_store',
      storage_key: `workspace/${workspace_id}/files/art_z/pending.pdf`,
      actor_id: 'tester',
    });

    await expect(
      open_file_bytes(db, {
        workspace_id,
        file_id: file.file_id,
        actor_id: 'tester',
      }),
    ).rejects.toThrow(/has not finished uploading/);
  });
});
