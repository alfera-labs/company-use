export const large_json_fields = ['content_json', 'model_visible_data'] as const;
export const keyed_json_fields = ['metadata', 'display'] as const;

export async function move_fields_in_order<Field extends string>(
  fields: readonly Field[],
  source: Readonly<Record<string, unknown>>,
  target: Record<string, unknown>,
  move: (value: unknown) => Promise<unknown>,
): Promise<void> {
  const [field, ...rest] = fields;
  if (field === undefined) return;
  if (source[field] !== undefined) target[field] = await move(source[field]);
  await move_fields_in_order(rest, source, target, move);
}
