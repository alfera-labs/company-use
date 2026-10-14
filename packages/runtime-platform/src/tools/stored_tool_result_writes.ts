import type { Database } from '@coworker/core';
import { stored_tool_result_file_purpose } from '@coworker/core/db/queries/files';
import { set_tool_call_output } from '@coworker/core/db/queries/sessions';
import { strip_unstorable_characters } from '@coworker/shared';
import {
  type ArtifactRef,
  is_large_value,
  read_artifact_ref,
  store_large_value,
} from '@runtime-platform/files/stored_body';
import {
  keyed_json_fields,
  large_json_fields,
  move_fields_in_order,
} from '@runtime-platform/tools/stored_tool_result_fields';
import { move_large_values_inside } from '@runtime-platform/tools/stored_tool_result_nested_values';
import type { ToolResultV2 } from '@runtime-platform/tools/stored_tool_result_shape';

const kept_display_chars = 8_000;

export async function store_tool_call_output(
  db: Database,
  input: {
    workspace_id: string;
    session_id: string;
    run_id: string;
    tool_call_id: string;
    output: ToolResultV2;
    output_text: string | null;
    output_file_id?: string | undefined;
    actor_id: string;
  },
) {
  const store = (value: unknown) =>
    store_large_value(db, {
      workspace_id: input.workspace_id,
      session_id: input.session_id,
      run_id: input.run_id,
      source_tool_call_id: input.tool_call_id,
      file_purpose: stored_tool_result_file_purpose,
      value,
      actor_id: input.actor_id,
    });
  const { output, artifact_ids } = await move_large_fields_to_storage(
    strip_unstorable_characters(input.output),
    store,
  );
  return set_tool_call_output(db, {
    tool_call_id: input.tool_call_id,
    output_data: output,
    output_text: input.output_text,
    output_file_id: input.output_file_id ?? artifact_ids[0] ?? null,
    actor_id: input.actor_id,
  });
}

async function move_large_fields_to_storage(
  output: ToolResultV2,
  store: (value: unknown) => Promise<ArtifactRef | null>,
) {
  const artifact_ids: string[] = [];
  const pointer_for = async (value: unknown) => {
    if (!is_large_value(value)) return value;
    const artifact_ref = await store(value);
    if (!artifact_ref) return value;
    artifact_ids.push(artifact_ref.artifact_id);
    return { artifact_ref, ...small_display_of(value) };
  };

  const moved: Record<string, unknown> = { ...output };
  await move_fields_in_order(large_json_fields, output, moved, pointer_for);
  await move_fields_in_order(keyed_json_fields, output, moved, (value) =>
    move_large_values_inside(value, pointer_for),
  );
  if (Array.isArray(output.content)) {
    moved.content = await Promise.all(
      output.content.map(async (part: Record<string, unknown>) =>
        part.type === 'image' && typeof part.data === 'string'
          ? image_part_with_data(part, await pointer_for(part.data))
          : part,
      ),
    );
  }
  return { output: moved as ToolResultV2, artifact_ids };
}

function small_display_of(value: unknown) {
  const display = (value as { display?: unknown } | null)?.display;
  if (typeof display !== 'object' || display === null) return {};
  const serialized = JSON.stringify(display);
  return serialized.length <= kept_display_chars ? { display } : {};
}

function image_part_with_data(part: Record<string, unknown>, data: unknown) {
  const { data: _data, ...rest } = part;
  const artifact_ref = read_artifact_ref(data);
  return artifact_ref ? { ...rest, artifact_ref } : { ...rest, data };
}
