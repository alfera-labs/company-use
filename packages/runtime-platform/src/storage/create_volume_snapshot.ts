import { createHash } from 'node:crypto';
import { assert_volume_storage_path } from '@coworker/shared';
import type { ObjectStorage } from '@runtime-platform/files/object_storage';
import { list_all_objects_by_prefix } from '@runtime-platform/storage/list_all_objects_by_prefix';
import {
  type ObjectToCapture,
  plan_volume_snapshot,
  type VolumeSnapshotPlan,
} from '@runtime-platform/storage/plan_volume_snapshot';
import {
  generate_blob_key,
  generate_manifest_key,
} from '@runtime-platform/storage/volume_snapshot_keys';
import {
  serialize_volume_snapshot_manifest,
  type VolumeSnapshotEntry,
  type VolumeSnapshotManifest,
  volume_snapshot_manifest_version,
} from '@runtime-platform/storage/volume_snapshot_manifest';

export type VolumeSnapshotResult = {
  generation_id: string;
  manifest_object_key: string;
  captured_object_count: number;
  carried_over_object_count: number;
  skipped_object_count: number;
  captured_bytes: number;
  newly_stored_bytes: number;
};

export type CreateVolumeSnapshotInput = {
  workspace_id: string;
  storage_path: string;
  generation_id: string;
  created_time: Date;
  source_bucket: string;
  volume_storage: ObjectStorage;
  backup_storage: ObjectStorage;
  previous_manifest: VolumeSnapshotManifest | null;
};

export async function create_volume_snapshot(
  input: CreateVolumeSnapshotInput,
): Promise<VolumeSnapshotResult> {
  const source_prefix = input.storage_path;
  assert_volume_storage_path(source_prefix);
  const source_objects = await list_all_objects_by_prefix(input.volume_storage, source_prefix);
  const snapshot_plan = plan_volume_snapshot({
    source_objects,
    source_prefix,
    previous_manifest: input.previous_manifest,
  });
  const captured = await capture_changed_objects(snapshot_plan.to_capture, input);
  const manifest = generate_snapshot_manifest({ input, source_prefix, snapshot_plan, captured });
  const manifest_object_key = await store_snapshot_manifest(manifest, input.backup_storage);
  return summarize_snapshot({ manifest, manifest_object_key, snapshot_plan, captured });
}

type CapturedObject = { entry: VolumeSnapshotEntry; stored_new_blob: boolean };

async function capture_changed_objects(
  objects_to_capture: readonly ObjectToCapture[],
  input: CreateVolumeSnapshotInput,
): Promise<CapturedObject[]> {
  const captured: CapturedObject[] = [];
  for (const object_to_capture of objects_to_capture) {
    captured.push(await capture_one_object(object_to_capture, input));
  }
  return captured;
}

async function capture_one_object(
  object_to_capture: ObjectToCapture,
  input: CreateVolumeSnapshotInput,
): Promise<CapturedObject> {
  const bytes = await read_source_object(object_to_capture, input);
  const content_sha256 = calculate_content_sha256(bytes);
  const { created } = await input.backup_storage.put_if_absent({
    object_key: generate_blob_key(content_sha256),
    data: bytes,
    content_type: 'application/octet-stream',
  });
  return {
    stored_new_blob: created,
    entry: {
      volume_relative_path: object_to_capture.volume_relative_path,
      byte_size: bytes.byteLength,
      entity_tag: object_to_capture.entity_tag,
      content_sha256,
    },
  };
}

async function read_source_object(
  object_to_capture: ObjectToCapture,
  input: CreateVolumeSnapshotInput,
): Promise<Uint8Array> {
  try {
    return await input.volume_storage.read(object_to_capture.source_object_key);
  } catch (error) {
    throw new Error(
      `Snapshot of workspace ${input.workspace_id} could not read ${object_to_capture.source_object_key}`,
      { cause: error },
    );
  }
}

function calculate_content_sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function generate_snapshot_manifest(context: {
  input: CreateVolumeSnapshotInput;
  source_prefix: string;
  snapshot_plan: VolumeSnapshotPlan;
  captured: readonly CapturedObject[];
}): VolumeSnapshotManifest {
  const { input, snapshot_plan, captured } = context;
  const entries = [...snapshot_plan.carried_over, ...captured.map((capture) => capture.entry)].sort(
    (left, right) => left.volume_relative_path.localeCompare(right.volume_relative_path),
  );
  return {
    manifest_kind: 'volume_snapshot',
    manifest_version: volume_snapshot_manifest_version,
    workspace_id: input.workspace_id,
    generation_id: input.generation_id,
    source_bucket: input.source_bucket,
    source_prefix: context.source_prefix,
    created_time: input.created_time.toISOString(),
    entries,
    skipped: [...snapshot_plan.skipped],
    totals: {
      copied_objects: captured.length,
      reused_objects: snapshot_plan.carried_over.length,
      skipped_objects: snapshot_plan.skipped.length,
      captured_bytes: entries.reduce((total, entry) => total + entry.byte_size, 0),
    },
  };
}

async function store_snapshot_manifest(
  manifest: VolumeSnapshotManifest,
  backup_storage: ObjectStorage,
): Promise<string> {
  const manifest_object_key = generate_manifest_key({
    workspace_id: manifest.workspace_id,
    generation_id: manifest.generation_id,
  });
  await backup_storage.put_if_absent({
    object_key: manifest_object_key,
    data: serialize_volume_snapshot_manifest(manifest),
    content_type: 'application/json',
  });
  return manifest_object_key;
}

function summarize_snapshot(context: {
  manifest: VolumeSnapshotManifest;
  manifest_object_key: string;
  snapshot_plan: VolumeSnapshotPlan;
  captured: readonly CapturedObject[];
}): VolumeSnapshotResult {
  return {
    generation_id: context.manifest.generation_id,
    manifest_object_key: context.manifest_object_key,
    captured_object_count: context.captured.length,
    carried_over_object_count: context.snapshot_plan.carried_over.length,
    skipped_object_count: context.snapshot_plan.skipped.length,
    captured_bytes: context.manifest.totals.captured_bytes,
    newly_stored_bytes: context.captured
      .filter((capture) => capture.stored_new_blob)
      .reduce((total, capture) => total + capture.entry.byte_size, 0),
  };
}
