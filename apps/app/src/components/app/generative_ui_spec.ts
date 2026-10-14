import type { Spec } from '@json-render/core';

export function json_render_spec_from_value(value: unknown): Spec | null {
  const record = value as Partial<Spec> & { spec?: Partial<Spec> };
  const candidate = record.spec ?? record;
  if (typeof candidate.root !== 'string') return null;
  if (
    !candidate.elements ||
    typeof candidate.elements !== 'object' ||
    Array.isArray(candidate.elements)
  ) {
    return null;
  }
  return candidate as Spec;
}
