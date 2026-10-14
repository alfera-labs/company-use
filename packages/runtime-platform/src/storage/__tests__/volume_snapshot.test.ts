import { createHash } from 'node:crypto';
import { create_in_memory_object_storage } from '@runtime-platform/files/in_memory_object_storage';
import type { ObjectStorage } from '@runtime-platform/files/object_storage';
import { create_volume_snapshot } from '@runtime-platform/storage/create_volume_snapshot';
import { find_latest_volume_snapshot_manifest } from '@runtime-platform/storage/find_latest_volume_snapshot';
import {
  generate_blob_key,
  generate_generation_id,
  generate_volume_object_prefix,
} from '@runtime-platform/storage/volume_snapshot_keys';
import { load_volume_snapshot_manifest } from '@runtime-platform/storage/volume_snapshot_manifest';
import { describe, expect, it } from 'vitest';

function create_recording_bucket() {
  const storage = create_in_memory_object_storage();
  const read_keys: string[] = [];
  const recording: ObjectStorage = {
    ...storage,
    read: async (object_key) => {
      read_keys.push(object_key);
      return storage.read(object_key);
    },
  };
  return { storage: recording, objects: storage.objects, read_keys };
}

const workspace_id = 'ws_123';
const storage_path = 'coworker/volumes/vol_01000000000000000000000006/';
const prefix = generate_volume_object_prefix({
  volume_id: 'vol_test',
  volume_config: { storage_path },
});
const encode = (text: string) => new TextEncoder().encode(text);

function write_volume_file(
  bucket: ReturnType<typeof create_recording_bucket>,
  path: string,
  body: string,
) {
  bucket.objects.set(`${prefix}${path}`, { data: encode(body), content_type: 'text/plain' });
}

async function snapshot(
  volume: ReturnType<typeof create_recording_bucket>,
  backup: ReturnType<typeof create_recording_bucket>,
  generation_id: string,
  previous_manifest_key: string | null,
) {
  const previous_manifest = previous_manifest_key
    ? load_volume_snapshot_manifest(await backup.storage.read(previous_manifest_key))
    : null;
  return create_volume_snapshot({
    workspace_id,
    storage_path,
    generation_id,
    created_time: new Date('2026-08-11T00:00:00.000Z'),
    source_bucket: 'coworker-prod-volumes',
    volume_storage: volume.storage,
    backup_storage: backup.storage,
    previous_manifest,
  });
}

describe('volume snapshots', () => {
  it('captures every file, then reads only what changed on the next generation', async () => {
    const volume = create_recording_bucket();
    const backup = create_recording_bucket();
    write_volume_file(volume, 'workspace/repo/a.md', 'alpha');
    write_volume_file(volume, 'workspace/repo/b.md', 'beta');

    const first = await snapshot(volume, backup, 'gen-1', null);
    expect(first.captured_object_count).toBe(2);
    expect(first.carried_over_object_count).toBe(0);

    backup.read_keys.length = 0;
    volume.read_keys.length = 0;
    write_volume_file(volume, 'workspace/repo/b.md', 'beta-changed');

    const second = await snapshot(volume, backup, 'gen-2', first.manifest_object_key);
    expect(second.captured_object_count).toBe(1);
    expect(second.carried_over_object_count).toBe(1);
    expect(volume.read_keys).toEqual([`${prefix}workspace/repo/b.md`]);
  });

  it('stores identical content once across workspaces and generations', async () => {
    const volume = create_recording_bucket();
    const backup = create_recording_bucket();
    write_volume_file(volume, 'workspace/repo/one.md', 'same bytes');
    write_volume_file(volume, 'workspace/repo/two.md', 'same bytes');

    const result = await snapshot(volume, backup, 'gen-1', null);
    const blob_keys = [...backup.objects.keys()].filter((key) => key.startsWith('blobs/'));
    expect(blob_keys).toHaveLength(1);
    expect(result.newly_stored_bytes).toBe('same bytes'.length);
    expect(blob_keys[0]).toBe(
      generate_blob_key(createHash('sha256').update('same bytes').digest('hex')),
    );
  });

  it('records skipped paths in the manifest instead of dropping them silently', async () => {
    const volume = create_recording_bucket();
    const backup = create_recording_bucket();
    write_volume_file(volume, 'workspace/repo/keep.md', 'keep');
    write_volume_file(volume, '.agent-browser/browsers/chrome/chrome', 'huge binary');

    const result = await snapshot(volume, backup, 'gen-1', null);
    const manifest = load_volume_snapshot_manifest(
      await backup.storage.read(result.manifest_object_key),
    );
    expect(manifest.entries.map((entry) => entry.volume_relative_path)).toEqual([
      'workspace/repo/keep.md',
    ]);
    expect(manifest.skipped[0]?.volume_relative_path).toBe('.agent-browser/browsers/chrome/chrome');
    expect(manifest.skipped[0]?.skipped_because).toMatch(/reinstalled/iu);
  });

  it('refuses a manifest written by a newer deploy', () => {
    const newer = encode(
      JSON.stringify({ manifest_kind: 'volume_snapshot', manifest_version: 99 }),
    );
    expect(() => load_volume_snapshot_manifest(newer)).toThrow(/newer deploy/u);
  });

  it('finds the newest generation from the manifest keys alone, with no snapshot table', async () => {
    const volume = create_recording_bucket();
    const backup = create_recording_bucket();
    write_volume_file(volume, 'workspace/repo/a.md', 'v1');
    await snapshot(volume, backup, generate_generation_id(new Date('2026-08-10T03:00:00Z')), null);
    write_volume_file(volume, 'workspace/repo/a.md', 'v2');
    await snapshot(volume, backup, generate_generation_id(new Date('2026-08-12T03:00:00Z')), null);
    write_volume_file(volume, 'workspace/repo/a.md', 'v0');
    await snapshot(volume, backup, generate_generation_id(new Date('2026-08-09T03:00:00Z')), null);

    const latest = await find_latest_volume_snapshot_manifest(backup.storage, workspace_id);
    expect(latest?.generation_id).toBe('2026-08-12T03-00-00.000Z');
    expect(latest?.entries[0]?.content_sha256).toBe(sha256_of('v2'));
  });

  it('survives a retry after the manifest was already written', async () => {
    const volume = create_recording_bucket();
    const backup = create_recording_bucket();
    write_volume_file(volume, 'workspace/repo/a.md', 'alpha');
    const generation = generate_generation_id(new Date('2026-08-12T03:00:00Z'));
    const first = await snapshot(volume, backup, generation, null);
    const retry = await snapshot(volume, backup, generation, null);
    expect(retry.manifest_object_key).toBe(first.manifest_object_key);
    expect(retry.newly_stored_bytes).toBe(0);
    const manifest = load_volume_snapshot_manifest(
      await backup.storage.read(first.manifest_object_key),
    );
    expect(manifest.entries).toHaveLength(1);
  });

  it('reports no baseline for a workspace that has never completed a snapshot', async () => {
    const backup = create_recording_bucket();
    expect(await find_latest_volume_snapshot_manifest(backup.storage, 'ws_never')).toBeNull();
  });
});

function sha256_of(text: string) {
  return createHash('sha256').update(text).digest('hex');
}

describe('generate_volume_object_prefix', () => {
  it('returns the prefix the volume records, whatever layout it was created under', () => {
    expect(
      generate_volume_object_prefix({
        volume_id: 'vol_test',
        volume_config: { storage_path: 'coworker/volumes/vol_abc/' },
      }),
    ).toBe('coworker/volumes/vol_abc/');
    expect(
      generate_volume_object_prefix({
        volume_id: 'vol_test',
        volume_config: { storage_path: 'coworker/workspaces/ws_123/' },
      }),
    ).toBe('coworker/workspaces/ws_123/');
  });

  it('refuses a recorded prefix that does not end in a slash', () => {
    expect(() =>
      generate_volume_object_prefix({
        volume_id: 'vol_test',
        volume_config: { storage_path: 'coworker/volumes/vol_abc' },
      }),
    ).toThrow(/must end in/u);
  });

  it('refuses a prefix that escapes the bucket layout', () => {
    expect(() =>
      generate_volume_object_prefix({
        volume_id: 'vol_test',
        volume_config: { storage_path: '/coworker/volumes/x/' },
      }),
    ).toThrow(/plain relative path/u);
    expect(() =>
      generate_volume_object_prefix({
        volume_id: 'vol_test',
        volume_config: { storage_path: 'coworker/../volumes/x/' },
      }),
    ).toThrow(/plain relative path/u);
  });
});
