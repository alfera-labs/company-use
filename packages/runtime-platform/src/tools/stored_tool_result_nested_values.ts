import {
  type ArtifactRef,
  is_large_value,
  read_artifact_ref,
} from '@runtime-platform/files/stored_body';

export async function move_large_values_inside(
  value: unknown,
  pointer_for: (value: unknown) => Promise<unknown>,
): Promise<unknown> {
  if (!is_large_value(value)) return value;
  if (!is_plain_record(value)) return pointer_for(value);
  const entries = await Promise.all(
    Object.entries(value).map(async ([key, entry]) => {
      const moved = holds_large_value(entry)
        ? await move_large_values_inside(entry, pointer_for)
        : await pointer_for(entry);
      return [key, moved] as const;
    }),
  );
  return Object.fromEntries(entries);
}

function holds_large_value(value: unknown) {
  return (
    is_plain_record(value) &&
    is_large_value(value) &&
    Object.values(value).some((entry) => is_large_value(entry))
  );
}

export function list_refs_inside(value: unknown): ArtifactRef[] {
  const artifact_ref = read_artifact_ref(value);
  if (artifact_ref) return [artifact_ref];
  return is_plain_record(value) ? Object.values(value).flatMap(list_refs_inside) : [];
}

export function put_values_back_inside(
  value: unknown,
  put_back: (pointer: unknown, artifact_ref: ArtifactRef) => unknown,
): unknown {
  const artifact_ref = read_artifact_ref(value);
  if (artifact_ref) return put_back(value, artifact_ref);
  if (!is_plain_record(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, put_values_back_inside(entry, put_back)]),
  );
}

function is_plain_record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
