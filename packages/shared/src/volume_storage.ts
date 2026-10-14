import volume_storage_layouts_data from '@coworker/shared/volume_storage_layouts.json' with {
  type: 'json',
};
import { parse_json_config } from '@shared/parse_json_config';
import { z } from 'zod';

const volume_storage_layout_schema = z
  .object({
    layout_name: z.string().min(1),
    status: z.enum(['current', 'available', 'legacy']),
    path_template: z.string().min(1),
    description: z.string().min(1),
  })
  .strict();

const volume_storage_layouts_file_schema = z
  .object({
    current_layout: z.string().min(1),
    volume_storage_layouts: z.array(volume_storage_layout_schema).min(1),
  })
  .strict();

export type VolumeStorageLayout = z.infer<typeof volume_storage_layout_schema>;

const volume_storage_layouts_file = parse_json_config(
  'volume_storage_layouts.json',
  volume_storage_layouts_file_schema,
  volume_storage_layouts_data,
);

const layouts_by_name = new Map(
  volume_storage_layouts_file.volume_storage_layouts.map((layout) => [layout.layout_name, layout]),
);

const current_layout = layouts_by_name.get(volume_storage_layouts_file.current_layout);
if (!current_layout) {
  throw new Error(
    `volume_storage_layouts.json names "${volume_storage_layouts_file.current_layout}" as current, and no layout has that name.`,
  );
}
if (current_layout.status === 'legacy') {
  throw new Error(
    `volume_storage_layouts.json points current_layout at "${current_layout.layout_name}", which is retired.`,
  );
}

const current_volume_storage_layout: VolumeStorageLayout = current_layout;

/**
 * The config a new volume starts with: where its bytes live, and which layout said so. Call this
 * once, where the volume row is created, and store what it returns. Nothing recomputes it after.
 */
export function resolve_volume_config(input: {
  volume_id: string;
  workspace_id: string;
  workspace_layout_version: number;
  layout?: VolumeStorageLayout;
}): { storage_path: string; storage_layout: string; workspace_layout_version: number } {
  const layout = input.layout ?? current_volume_storage_layout;
  const storage_path = layout.path_template
    .replaceAll('{volume_id}', path_segment(input.volume_id, 'volume_id'))
    .replaceAll('{workspace_id}', path_segment(input.workspace_id, 'workspace_id'));
  assert_volume_storage_path(storage_path);
  return {
    storage_path,
    storage_layout: layout.layout_name,
    workspace_layout_version: input.workspace_layout_version,
  };
}

/**
 * The path a volume records. Throws when a row has none: a volume whose path is unknown must
 * stop the caller rather than send it somewhere that lists nothing.
 */
export function read_volume_storage_path(volume: {
  volume_id: string;
  volume_config: { storage_path?: string };
}): string {
  const prefix = volume.volume_config.storage_path;
  if (!prefix) {
    throw new Error(`Volume ${volume.volume_id} records no storage_path in volume_config.`);
  }
  assert_volume_storage_path(prefix);
  return prefix;
}

/**
 * Throws unless a path is one this system will read. A path missing its trailing slash lists
 * every sibling whose name merely starts the same, so a backup of `vol_1` would sweep up `vol_10`.
 */
export function assert_volume_storage_path(storage_path: string): void {
  if (!storage_path.endsWith('/')) {
    throw new Error(`A volume storage path must end in "/", got "${storage_path}"`);
  }
  if (storage_path.startsWith('/') || storage_path.includes('//') || storage_path.includes('..')) {
    throw new Error(`A volume storage path must be a plain relative path, got "${storage_path}"`);
  }
  if (storage_path.includes('{') || storage_path.includes('}')) {
    throw new Error(
      `A volume storage path still holds an unresolved placeholder: "${storage_path}"`,
    );
  }
}

function path_segment(value: string, field_name: string) {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error(`Volume storage ${field_name} is not usable as a path segment: "${value}"`);
  }
  return value;
}
