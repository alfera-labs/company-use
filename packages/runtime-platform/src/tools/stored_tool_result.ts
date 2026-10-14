import type { Database } from '@coworker/core';
import { create_logger } from '@coworker/shared';
import {
  type ArtifactRef,
  load_stored_values,
  read_artifact_ref,
} from '@runtime-platform/files/stored_body';
import {
  keyed_json_fields,
  large_json_fields,
} from '@runtime-platform/tools/stored_tool_result_fields';
import {
  list_refs_inside,
  put_values_back_inside,
} from '@runtime-platform/tools/stored_tool_result_nested_values';
import type { ToolResultV2 } from '@runtime-platform/tools/stored_tool_result_shape';

const log = create_logger('stored_tool_result');

export { store_tool_call_output } from '@runtime-platform/tools/stored_tool_result_writes';

export type LargeValueReading = 'load_full_value' | 'use_preview' | 'load_model_visible_value';

export async function resolve_large_fields(
  db: Database,
  input: { workspace_id: string; outputs: ToolResultV2[]; reading: LargeValueReading },
): Promise<ToolResultV2[]> {
  const refs = input.outputs.flatMap((output) =>
    list_artifact_refs(output).map((ref) => ({ ref, output })),
  );
  if (refs.length === 0) return input.outputs;

  const is_needed = loads_value_by_reading[input.reading];
  const artifact_ids = refs
    .filter(({ ref, output }) => is_needed(ref, output))
    .map(({ ref }) => ref.artifact_ref.artifact_id);
  const loaded = await load_values_or_report(db, input.workspace_id, artifact_ids);
  const value_for: ValueFor = (pointer, ref, output) => {
    if (loaded.has(ref.artifact_ref.artifact_id)) return loaded.get(ref.artifact_ref.artifact_id);
    if (input.reading === 'load_model_visible_value' && !is_needed(ref, output)) return pointer;
    return preview_marker(pointer, ref.artifact_ref);
  };
  return input.outputs.map((output) => put_values_back(output, value_for));
}

const loads_value_by_reading: Record<
  LargeValueReading,
  (ref: ListedRef, output: ToolResultV2) => boolean
> = {
  load_full_value: () => true,
  use_preview: (ref) => ref.field === 'image',
  load_model_visible_value: (ref, output) =>
    ref.field === 'image' ||
    (ref.field === 'content_json' && !output.content_text) ||
    (ref.field === 'metadata' && reads_metadata_as_text(output)),
};

function reads_metadata_as_text(output: ToolResultV2) {
  return output.ok && !output.content_text && output.content_json === undefined;
}

async function load_values_or_report(db: Database, workspace_id: string, artifact_ids: string[]) {
  if (artifact_ids.length === 0) return new Map<string, unknown>();
  try {
    const loaded = await load_stored_values(db, { workspace_id, artifact_ids });
    const missing = artifact_ids.filter((artifact_id) => !loaded.has(artifact_id));
    if (missing.length > 0) {
      log.error('Stored tool values are missing; their previews stand in.', {
        workspace_id,
        artifact_ids: missing,
      });
    }
    return loaded;
  } catch (error) {
    log.error('Reading stored tool values failed; their previews stand in.', {
      workspace_id,
      artifact_ids,
      error: error instanceof Error ? error.message : String(error),
    });
    return new Map<string, unknown>();
  }
}

type ListedRef = {
  field: (typeof large_json_fields)[number] | (typeof keyed_json_fields)[number] | 'image';
  artifact_ref: ArtifactRef;
};
type ValueFor = (pointer: unknown, ref: ListedRef, output: ToolResultV2) => unknown;

function list_artifact_refs(output: ToolResultV2): ListedRef[] {
  const json_refs = large_json_fields.flatMap((field) => {
    const artifact_ref = read_artifact_ref(output[field]);
    return artifact_ref ? [{ field, artifact_ref }] : [];
  });
  const keyed_refs = keyed_json_fields.flatMap((field) =>
    list_refs_inside(output[field]).map((artifact_ref) => ({ field, artifact_ref })),
  );
  const image_refs = (Array.isArray(output.content) ? output.content : []).flatMap(
    (part: unknown) => {
      const artifact_ref = read_artifact_ref(part);
      return artifact_ref ? [{ field: 'image' as const, artifact_ref }] : [];
    },
  );
  return [...json_refs, ...keyed_refs, ...image_refs];
}

function put_values_back(output: ToolResultV2, value_for: ValueFor): ToolResultV2 {
  const restored: Record<string, unknown> = { ...output };
  for (const field of large_json_fields) {
    const artifact_ref = read_artifact_ref(output[field]);
    if (artifact_ref) restored[field] = value_for(output[field], { field, artifact_ref }, output);
  }
  for (const field of keyed_json_fields) {
    if (output[field] === undefined) continue;
    restored[field] = put_values_back_inside(output[field], (pointer, artifact_ref) =>
      value_for(pointer, { field, artifact_ref }, output),
    );
  }
  if (Array.isArray(output.content)) {
    restored.content = output.content.map((part: Record<string, unknown>) => {
      const artifact_ref = read_artifact_ref(part);
      if (!artifact_ref) return part;
      const { artifact_ref: _artifact_ref, ...rest } = part;
      return { ...rest, data: value_for(part, { field: 'image', artifact_ref }, output) };
    });
  }
  return restored as ToolResultV2;
}

function preview_marker(pointer: unknown, artifact_ref: ArtifactRef) {
  const display = (pointer as { display?: unknown }).display;
  return {
    wire_truncated: true,
    original_chars: artifact_ref.byte_size,
    preview: artifact_ref.preview,
    ...(display === undefined ? {} : { display }),
  };
}
