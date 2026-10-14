import type { ObjectStorage } from '@runtime-platform/files/object_storage';
import { list_all_objects_by_prefix } from '@runtime-platform/storage/list_all_objects_by_prefix';
import { generate_workspace_manifest_prefix } from '@runtime-platform/storage/volume_snapshot_keys';
import {
  load_volume_snapshot_manifest,
  type VolumeSnapshotManifest,
} from '@runtime-platform/storage/volume_snapshot_manifest';

/** Null when this workspace has never finished a backup. */
export async function find_latest_volume_snapshot_manifest(
  backup_storage: ObjectStorage,
  workspace_id: string,
): Promise<VolumeSnapshotManifest | null> {
  const manifests = await list_all_objects_by_prefix(
    backup_storage,
    generate_workspace_manifest_prefix(workspace_id),
  );
  const newest = manifests
    .map((manifest) => manifest.object_key)
    .sort()
    .at(-1);
  if (!newest) return null;
  return load_volume_snapshot_manifest(await backup_storage.read(newest));
}
