export function project_tool_output(output: unknown, field_names: string[]) {
  const selected_fields = new Set(field_names);
  if (
    output === null ||
    typeof output !== 'object' ||
    Array.isArray(output) ||
    !('output' in output)
  ) {
    return project_selected_fields(output, selected_fields).value ?? output;
  }

  const projected_output = project_selected_fields(output.output, selected_fields);
  if (!projected_output.matched) return output;
  return { ...output, output: projected_output.value };
}

function project_selected_fields(
  value: unknown,
  selected_fields: Set<string>,
): { matched: boolean; value?: unknown } {
  if (Array.isArray(value)) {
    const items = value.map((item) => project_selected_fields(item, selected_fields));
    if (!items.some((item) => item.matched)) return { matched: false };
    return { matched: true, value: items.map((item) => item.value ?? null) };
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { matched: false };
  }

  const entries = Object.entries(value).flatMap(([key, nested_value]) => {
    if (selected_fields.has(key)) return [[key, nested_value] as const];
    const nested_result = project_selected_fields(nested_value, selected_fields);
    return nested_result.matched ? [[key, nested_result.value] as const] : [];
  });
  return entries.length > 0
    ? { matched: true, value: Object.fromEntries(entries) }
    : { matched: false };
}
