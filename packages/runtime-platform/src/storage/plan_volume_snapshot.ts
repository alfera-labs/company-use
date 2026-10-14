import type { ListedObject } from '@runtime-platform/files/object_storage';
import type {
  VolumeSnapshotEntry,
  VolumeSnapshotManifest,
} from '@runtime-platform/storage/volume_snapshot_manifest';
import { index_manifest_entries_by_path } from '@runtime-platform/storage/volume_snapshot_manifest';
import {
  find_snapshot_skip_rule,
  max_snapshot_object_bytes,
} from '@runtime-platform/storage/volume_snapshot_policy';

export type ObjectToCapture = {
  volume_relative_path: string;
  source_object_key: string;
  byte_size: number;
  entity_tag: string;
};

type SkippedObject = {
  volume_relative_path: string;
  byte_size: number;
  skipped_because: string;
};

export type VolumeSnapshotPlan = {
  carried_over: VolumeSnapshotEntry[];
  to_capture: ObjectToCapture[];
  skipped: SkippedObject[];
};

export function plan_volume_snapshot(input: {
  source_objects: readonly ListedObject[];
  source_prefix: string;
  previous_manifest: VolumeSnapshotManifest | null;
}): VolumeSnapshotPlan {
  const previous_entries = index_manifest_entries_by_path(input.previous_manifest);
  const plan: VolumeSnapshotPlan = { carried_over: [], to_capture: [], skipped: [] };

  for (const source_object of input.source_objects) {
    const volume_relative_path = calculate_volume_relative_path(
      source_object.object_key,
      input.source_prefix,
    );
    if (volume_relative_path === null) continue;

    const skipped_because = calculate_skip_reason(volume_relative_path, source_object.byte_size);
    if (skipped_because !== null) {
      plan.skipped.push({
        volume_relative_path,
        byte_size: source_object.byte_size,
        skipped_because,
      });
      continue;
    }

    const previous_entry = previous_entries.get(volume_relative_path);
    if (is_unchanged_since(previous_entry, source_object)) {
      plan.carried_over.push(previous_entry);
      continue;
    }
    plan.to_capture.push({
      volume_relative_path,
      source_object_key: source_object.object_key,
      byte_size: source_object.byte_size,
      entity_tag: source_object.entity_tag,
    });
  }
  return plan;
}

function is_unchanged_since(
  previous_entry: VolumeSnapshotEntry | undefined,
  source_object: ListedObject,
): previous_entry is VolumeSnapshotEntry {
  if (!previous_entry) return false;
  if (previous_entry.byte_size !== source_object.byte_size) return false;
  return previous_entry.entity_tag !== '' && previous_entry.entity_tag === source_object.entity_tag;
}

function calculate_skip_reason(volume_relative_path: string, byte_size: number): string | null {
  const skip_rule = find_snapshot_skip_rule(volume_relative_path);
  if (skip_rule) return skip_rule.skipped_because;
  if (byte_size > max_snapshot_object_bytes) {
    return `Object is ${byte_size} bytes, above the ${max_snapshot_object_bytes} byte per-object snapshot limit.`;
  }
  return null;
}

function calculate_volume_relative_path(object_key: string, source_prefix: string): string | null {
  if (!object_key.startsWith(source_prefix)) return null;
  const volume_relative_path = object_key.slice(source_prefix.length);
  return volume_relative_path === '' ? null : volume_relative_path;
}
