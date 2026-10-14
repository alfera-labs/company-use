import type { NodeInputSchemaData } from '@coworker/core/db/schema/json_column_types';
import { ValidationError } from '@coworker/shared';
import { read_trigger_provider_app_id } from '@runtime-platform/tools/definitions/trigger_node_fields';
import { find_trigger_field_hint } from '@runtime-platform/tools/trigger_field_hints';
import { z } from 'zod';

type TriggerNodeSchema = {
  node_key: string;
  input_schema: NodeInputSchemaData;
  node_config?: unknown;
};

export function refuse_missing_setup_fields(
  node: TriggerNodeSchema,
  subscription_config: Record<string, unknown>,
) {
  const properties = node.input_schema.properties ?? {};
  const missing = (node.input_schema.required ?? []).filter((field) => {
    const property = properties[field];
    if (property && typeof property === 'object' && 'default' in property) return false;
    const value = subscription_config[field];
    return value === undefined || value === null || value === '';
  });
  if (missing.length === 0) return;
  throw new ValidationError(
    `Trigger ${node.node_key} needs ${missing.join(', ')} in subscription_config`,
  );
}

const number_property_schema = z
  .object({
    type: z
      .preprocess(
        (type) =>
          Array.isArray(type) ? type.find((word) => word === 'number' || word === 'integer') : type,
        z.enum(['number', 'integer']),
      )
      .optional()
      .catch(undefined),
    minimum: z.number().optional().catch(undefined),
    maximum: z.number().optional().catch(undefined),
    multipleOf: z.number().positive().optional().catch(undefined),
  })
  .catch({});

type NumberProperty = z.infer<typeof number_property_schema>;

const number_value_schema = z.union([
  z.number(),
  z
    .string()
    .trim()
    .min(1)
    .transform((text) => Number(text))
    .pipe(z.number()),
]);

export function parse_subscription_numbers(
  node: TriggerNodeSchema,
  subscription_config: Record<string, unknown>,
): Record<string, unknown> {
  const properties = node.input_schema.properties ?? {};
  const provider_app_id = read_trigger_provider_app_id(node.node_config);
  const parsed = { ...subscription_config };
  for (const [field, value] of Object.entries(subscription_config)) {
    const property = with_provider_floor(
      number_property_schema.parse(properties[field] ?? {}),
      find_trigger_field_hint(field, provider_app_id)?.minimum,
    );
    const is_number_field = property.type !== undefined || typeof value === 'number';
    if (!is_number_field || value === undefined || value === null || value === '') continue;
    const number = number_value_schema.safeParse(value);
    if (!number.success) {
      throw new ValidationError(
        `Trigger ${node.node_key} needs ${field} to be a number, not ${JSON.stringify(value)}`,
      );
    }
    const broken = find_broken_number_bound(property, number.data);
    if (broken) throw new ValidationError(`Trigger ${node.node_key} needs ${field} ${broken}`);
    parsed[field] = number.data;
  }
  return parsed;
}

function with_provider_floor(property: NumberProperty, floor: number | undefined): NumberProperty {
  if (floor === undefined) return property;
  return { ...property, minimum: Math.max(property.minimum ?? floor, floor) };
}

function find_broken_number_bound(property: NumberProperty, value: number): string | null {
  const { minimum, maximum, multipleOf } = property;
  if (property.type === 'integer' && !Number.isInteger(value)) return 'to be a whole number';
  if (minimum !== undefined && value < minimum) return `to be at least ${minimum}`;
  if (maximum !== undefined && value > maximum) return `to be at most ${maximum}`;
  if (multipleOf !== undefined && !is_multiple_of(value, multipleOf)) {
    return `to be a multiple of ${multipleOf}`;
  }
  return null;
}

function is_multiple_of(value: number, step: number) {
  const quotient = value / step;
  return Math.abs(quotient - Math.round(quotient)) < 1e-9;
}
