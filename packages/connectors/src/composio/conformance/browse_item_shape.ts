import {
  element_shape,
  resolve_shape_path,
  type Shape,
} from '@connectors/composio/conformance/expression_shape';
import { is_plain_record } from '@connectors/value_expression';

export function find_browse_item_shape(response: Shape): {
  item: Shape | null;
  problem: string | null;
} {
  if (response.kind === 'open') return { item: { kind: 'open' }, problem: null };
  const bare_item = element_shape(response);
  if (bare_item) return { item: bare_item, problem: null };
  for (const name of ['options', 'items']) {
    const { shape } = resolve_shape_path({ response }, `response.${name}`);
    const item = shape.kind === 'missing' ? null : element_shape(shape);
    if (item) return { item, problem: null };
  }
  if (response.kind !== 'schema') return { item: null, problem: 'response is not a schema' };
  const names = [
    ...new Set(
      response.schemas.flatMap((branch) =>
        is_plain_record(branch.schema.properties) ? Object.keys(branch.schema.properties) : [],
      ),
    ),
  ];
  const arrays = names.flatMap((name) => {
    const { shape } = resolve_shape_path({ response }, `response.${name}`);
    const item = shape.kind === 'missing' ? null : element_shape(shape);
    return item ? [{ name, item }] : [];
  });
  if (arrays.length === 1 && arrays[0]) return { item: arrays[0].item, problem: null };
  const found = arrays.map((entry) => entry.name).join(', ') || 'none';
  return {
    item: null,
    problem: `top-level arrays: ${found} (top-level keys: ${names.join(', ') || 'none'})`,
  };
}
