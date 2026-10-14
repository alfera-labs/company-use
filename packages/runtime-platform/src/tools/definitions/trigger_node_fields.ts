import {
  find_trigger_field_hint,
  read_trigger_field_words,
} from '@runtime-platform/tools/trigger_field_hints';
import { z } from 'zod';

const json_schema_property_schema = z
  .object({
    title: z.string().optional().catch(undefined),
    description: z.string().optional().catch(undefined),
    type: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .catch(undefined),
    enum: z.array(z.unknown()).optional().catch(undefined),
  })
  .loose();

const json_schema_properties_schema = z
  .object({
    properties: z.record(z.string(), json_schema_property_schema).optional(),
    required: z.array(z.string()).optional().catch(undefined),
  })
  .loose();

const node_provenance_schema = z
  .object({
    sourced_from: z.object({ provider_app_id: z.string() }).loose(),
  })
  .loose()
  .transform((config) => config.sourced_from.provider_app_id)
  .nullable()
  .catch(null);

export function read_trigger_provider_app_id(node_config: unknown): string | null {
  return node_provenance_schema.parse(node_config ?? null);
}

export type TriggerNodeFieldSource = {
  input_schema: unknown;
  output_schema: unknown;
  node_config?: unknown;
  metadata: { description?: string | null; data_fields?: string[] } | null;
};

export function read_setup_fields(node: TriggerNodeFieldSource) {
  const parsed = json_schema_properties_schema.safeParse(node.input_schema);
  if (!parsed.success) return [];
  const required = new Set(parsed.data.required ?? []);
  const provider_app_id = read_trigger_provider_app_id(node.node_config);
  return Object.entries(parsed.data.properties ?? {}).map(([name, property]) => ({
    name,
    label:
      find_trigger_field_hint(name, provider_app_id)?.label ??
      property.title ??
      format_field_label(name),
    description:
      find_trigger_field_hint(name, provider_app_id)?.description ?? property.description ?? null,
    required: required.has(name),
    type: (Array.isArray(property.type) ? property.type[0] : property.type) ?? null,
    ...(property.enum?.length ? { enum: property.enum } : {}),
    has_default: 'default' in property,
    ...read_trigger_field_words(name, provider_app_id, node.node_config),
  }));
}

export function read_event_fields(node: TriggerNodeFieldSource) {
  const from_schema = read_schema_properties(node.output_schema).map(([name, property]) => ({
    name,
    label: property.title ?? format_field_label(name),
  }));
  if (from_schema.length > 0) return from_schema;
  return (node.metadata?.data_fields ?? []).map((name) => ({
    name,
    label: format_field_label(name),
  }));
}

function format_field_label(name: string) {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\s-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function read_schema_properties(schema: unknown) {
  const parsed = json_schema_properties_schema.safeParse(schema);
  if (!parsed.success) return [];
  return Object.entries(parsed.data.properties ?? {});
}
