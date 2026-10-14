import { read_volume_storage_path } from '@coworker/shared';

export function generate_blob_key(content_sha256: string): string {
  if (!/^[0-9a-f]{64}$/u.test(content_sha256)) {
    throw new Error(`A blob key needs a lowercase hex sha256, got "${content_sha256}"`);
  }
  return `blobs/${content_sha256}`;
}

export function generate_manifest_key(input: {
  workspace_id: string;
  generation_id: string;
}): string {
  validate_key_part(input.workspace_id, 'workspace_id');
  validate_key_part(input.generation_id, 'generation_id');
  return `manifests/${input.workspace_id}/${input.generation_id}.json`;
}

export function generate_workspace_manifest_prefix(workspace_id: string): string {
  validate_key_part(workspace_id, 'workspace_id');
  return `manifests/${workspace_id}/`;
}

/**
 * The name of one backup. It is a timestamp, so sorting the names alphabetically also sorts
 * them by time. That is what lets us find the most recent backup by listing the bucket,
 * instead of keeping a database table of backups.
 */
export function generate_generation_id(created_time: Date): string {
  return created_time.toISOString().replace(/:/gu, '-');
}

/**
 * Where one volume's live files sit: the prefix the volume itself records.
 *
 * There is no fallback and no template here on purpose. The prefix is resolved once, from
 * volume_storage_layouts.json, when the volume row is created, and stored on the row. This
 * function only checks that what it was handed is safe to list, and throws when the row has
 * nothing to hand it.
 *
 * It used to derive the path from the workspace id, matching archil_volume_config because a
 * comment said the two agreed. The moment storage stopped being keyed by workspace, the backup
 * would have listed an empty prefix, copied nothing, and still written a manifest saying it had
 * finished.
 */
export function generate_volume_object_prefix(volume: {
  volume_id: string;
  volume_config: { storage_path?: string };
}): string {
  return read_volume_storage_path(volume);
}

function validate_key_part(value: string, field_name: string) {
  if (!/^[A-Za-z0-9_.-]+$/u.test(value) || value === '.' || value === '..') {
    throw new Error(`Backup ${field_name} must be url-safe, got "${value}"`);
  }
}
