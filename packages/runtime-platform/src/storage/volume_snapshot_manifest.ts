import { z } from 'zod';

export const volume_snapshot_manifest_version = 1;

const snapshot_entry_schema = z
  .object({
    volume_relative_path: z.string().min(1),
    byte_size: z.number().int().nonnegative(),
    entity_tag: z.string().min(1),
    content_sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  })
  .strict();

const skipped_entry_schema = z
  .object({
    volume_relative_path: z.string().min(1),
    byte_size: z.number().int().nonnegative(),
    skipped_because: z.string().min(1),
  })
  .strict();

const snapshot_totals_schema = z
  .object({
    copied_objects: z.number().int().nonnegative(),
    reused_objects: z.number().int().nonnegative(),
    skipped_objects: z.number().int().nonnegative(),
    captured_bytes: z.number().int().nonnegative(),
  })
  .strict();

const volume_snapshot_manifest_schema = z
  .object({
    manifest_kind: z.literal('volume_snapshot'),
    manifest_version: z.literal(volume_snapshot_manifest_version),
    workspace_id: z.string().min(1),
    generation_id: z.string().min(1),
    source_bucket: z.string().min(1),
    source_prefix: z.string().min(1),
    created_time: z.string().datetime(),
    entries: z.array(snapshot_entry_schema),
    skipped: z.array(skipped_entry_schema),
    totals: snapshot_totals_schema,
  })
  .strict();

export type VolumeSnapshotManifest = z.infer<typeof volume_snapshot_manifest_schema>;
export type VolumeSnapshotEntry = z.infer<typeof snapshot_entry_schema>;

export function serialize_volume_snapshot_manifest(manifest: VolumeSnapshotManifest): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(volume_snapshot_manifest_schema.parse(manifest)));
}

export function load_volume_snapshot_manifest(bytes: Uint8Array): VolumeSnapshotManifest {
  const decoded = parse_manifest_json(bytes);
  const stored_version = read_manifest_version(decoded);
  if (stored_version > volume_snapshot_manifest_version) {
    throw new Error(
      `Snapshot manifest version ${stored_version} was written by a newer deploy; this build reads up to ${volume_snapshot_manifest_version}`,
    );
  }
  return volume_snapshot_manifest_schema.parse(
    migrate_manifest_to_current(decoded, stored_version),
  );
}

function migrate_manifest_to_current(manifest: unknown, from_version: number): unknown {
  switch (from_version) {
    case volume_snapshot_manifest_version:
      return manifest;
    default:
      throw new Error(`No migration path from snapshot manifest version ${from_version}`);
  }
}

function parse_manifest_json(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    throw new Error('Snapshot manifest is not valid JSON', { cause: error });
  }
}

function read_manifest_version(manifest: unknown): number {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('Snapshot manifest must be a JSON object');
  }
  const { manifest_kind, manifest_version } = manifest as Record<string, unknown>;
  if (manifest_kind !== 'volume_snapshot') {
    throw new Error(`Expected a volume_snapshot manifest, found kind "${String(manifest_kind)}"`);
  }
  if (typeof manifest_version !== 'number' || !Number.isInteger(manifest_version)) {
    throw new Error('Snapshot manifest is missing an integer manifest_version');
  }
  return manifest_version;
}

// The previous generation's entries, keyed for the "has this file changed" lookup. Size is
// compared alongside the tag because a bucket may return a weak or multipart ETag.
export function index_manifest_entries_by_path(
  manifest: VolumeSnapshotManifest | null,
): Map<string, VolumeSnapshotEntry> {
  const entries_by_path = new Map<string, VolumeSnapshotEntry>();
  for (const entry of manifest?.entries ?? []) {
    entries_by_path.set(entry.volume_relative_path, entry);
  }
  return entries_by_path;
}
