import { createHash } from 'node:crypto';
import { z } from 'zod';

type CandidateField = { name: string; description: string };
type CandidateAction = { node_name: string; description: string; lists: string[] };
export type FieldChoiceCandidates = { fields: CandidateField[]; actions: CandidateAction[] };

type SeedLike = {
  node_kind: string;
  node_name: string;
  input_schema: unknown;
  output_schema?: unknown;
  metadata?: unknown;
};

const property_schema = z
  .object({
    type: z.unknown().optional(),
    enum: z.array(z.unknown()).optional(),
    default: z.unknown().optional(),
    description: z.string().optional(),
    title: z.string().optional(),
    items: z.unknown().optional(),
    properties: z.record(z.string(), z.unknown()).optional(),
  })
  .catch({});
const object_schema = z
  .object({
    properties: z.record(z.string(), z.unknown()).catch({}),
    required: z.array(z.string()).catch([]),
  })
  .catch({ properties: {}, required: [] });
const description_schema = z.object({ description: z.string() }).catch({ description: '' });

const max_actions = 120;
const max_fields = 60;
const list_action_name = /^(list|get|search|fetch|find|retrieve|query)_/;

export function collect_field_choice_candidates(seeds: SeedLike[]): FieldChoiceCandidates {
  const fields = new Map<string, CandidateField>();
  for (const seed of seeds) {
    if (seed.node_kind !== 'trigger') continue;
    for (const [name, raw] of Object.entries(object_schema.parse(seed.input_schema).properties)) {
      const property = property_schema.parse(raw);
      if (fields.has(name) || !could_hold_a_picked_thing(property)) continue;
      fields.set(name, { name, description: clip(property.description ?? property.title ?? '') });
    }
  }
  const actions = seeds
    .filter((seed) => seed.node_kind === 'action' && list_action_name.test(seed.node_name))
    .filter((seed) => needs_no_input(seed.input_schema))
    .map((seed) => ({
      node_name: seed.node_name,
      description: clip(description_schema.parse(seed.metadata).description, 110),
      lists: describe_lists(seed.output_schema),
    }))
    .sort((left, right) => list_rank(left.node_name) - list_rank(right.node_name))
    .slice(0, max_actions);
  return { fields: [...fields.values()].slice(0, max_fields), actions };
}

const mapper_version = 2;

export function fingerprint_candidates(candidates: FieldChoiceCandidates): string {
  const words = JSON.stringify({
    mapper_version,
    fields: candidates.fields.map((field) => field.name).sort(),
    actions: candidates.actions
      .map((action) => `${action.node_name}:${action.lists.join('|')}`)
      .sort(),
  });
  return createHash('sha256').update(words).digest('hex').slice(0, 16);
}

function list_rank(node_name: string) {
  return (node_name.startsWith('list_') ? 0 : 1000) + node_name.length;
}

function could_hold_a_picked_thing(property: z.infer<typeof property_schema>) {
  if (property.enum && property.enum.length > 0) return false;
  const types = Array.isArray(property.type) ? property.type : [property.type];
  if (types.includes('string')) return true;
  if (!types.includes('array')) return false;
  const items = property_schema.parse(property.items);
  return (Array.isArray(items.type) ? items.type : [items.type]).includes('string');
}

function needs_no_input(input_schema: unknown) {
  const schema = object_schema.parse(input_schema);
  return schema.required.every(
    (name) => property_schema.parse(schema.properties[name]).default !== undefined,
  );
}

export function describe_lists(output_schema: unknown, depth = 4): string[] {
  const found: string[] = [];
  const walk = (schema: unknown, path: string[], level: number) => {
    if (level > depth || found.length >= 3) return;
    const property = property_schema.parse(schema);
    if (property.type === 'array') {
      const item_keys = Object.keys(property_schema.parse(property.items).properties ?? {});
      found.push(
        `${[...path].join('.')}[]: ${item_keys.slice(0, 10).join(', ') || '(items not described)'}`,
      );
      return;
    }
    for (const [key, child] of Object.entries(property.properties ?? {}))
      walk(child, [...path, key], level + 1);
  };
  walk(output_schema, [], 0);
  return found;
}

function clip(text: string, length = 160) {
  const one_line = text.replace(/\s+/g, ' ').trim();
  return one_line.length > length ? `${one_line.slice(0, length)}…` : one_line;
}
