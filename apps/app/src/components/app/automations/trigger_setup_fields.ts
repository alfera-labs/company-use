import { z } from 'zod';
import type { TriggerTypeRow } from '@/components/app/automations/automations_api';

export type SetupField = {
  name: string;
  label: string;
  description: string | null;
  type: 'string' | 'number' | 'boolean';
  choices: string[] | null;
  required: boolean;
  has_default: boolean;
  default_value: string | number | boolean | null;
  minimum: number | null;
  maximum: number | null;
  multiple_of: number | null;
  whole_number: boolean;
  chip_word: string | null;
  empty_means: string | null;
  unit: string | null;
  hidden_at_default: boolean;
  choices_from_provider: boolean;
};

type ApiWords = Pick<
  SetupField,
  | 'label'
  | 'has_default'
  | 'chip_word'
  | 'empty_means'
  | 'unit'
  | 'hidden_at_default'
  | 'choices_from_provider'
>;
type ApiSetupField = TriggerTypeRow['setup_fields'][number];

const name_list = z.preprocess(
  (value) => (Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []),
  z.array(z.string()),
);

const optional_text = z.string().nullable().catch(null);

const box_kind = z
  .preprocess(
    (value) => (Array.isArray(value) ? value.find((item) => typeof item === 'string') : value),
    z.enum(['boolean', 'number', 'integer', 'string']).catch('string'),
  )
  .transform((word): SetupField['type'] => (word === 'integer' ? 'number' : word));

const optional_number = z.number().nullable().catch(null);

const property_schema = z.object({
  type: box_kind,
  description: optional_text,
  enum: name_list,
  default: z.union([z.string(), z.number(), z.boolean()]).nullable().catch(null),
  minimum: optional_number,
  maximum: optional_number,
  multipleOf: optional_number,
});

const raw_type_schema = z.object({ type: z.unknown() }).catch({ type: null });

const input_schema = z
  .object({
    properties: z.record(z.string(), z.unknown()).catch({}),
    required: name_list,
  })
  .catch({ properties: {}, required: [] });

export function read_setup_fields(
  raw_input_schema: unknown,
  api_fields: readonly ApiSetupField[] = [],
): SetupField[] {
  const schema = input_schema.parse(raw_input_schema);
  const required = new Set(schema.required);
  const words_of = new Map(api_fields.map((field) => [field.name, field]));
  return Object.entries(schema.properties).map(([name, value]) => {
    const property = property_schema.parse(value);
    return {
      ...read_one_field(name, property, required.has(name)),
      minimum: stricter_minimum(property.minimum, words_of.get(name)?.minimum ?? null),
      description: words_of.get(name)?.description ?? property.description,
      whole_number: is_integer_type(raw_type_schema.parse(value).type),
      ...read_api_words(name, words_of.get(name)),
    };
  });
}

function stricter_minimum(from_schema: number | null, from_provider: number | null) {
  if (from_schema === null) return from_provider;
  if (from_provider === null) return from_schema;
  return Math.max(from_schema, from_provider);
}

function read_api_words(name: string, field: ApiSetupField | undefined): ApiWords {
  return {
    label: field?.label ?? name,
    has_default: field?.has_default ?? false,
    chip_word: field?.chip_word ?? null,
    empty_means: field?.empty_means ?? null,
    unit: field?.unit ?? null,
    hidden_at_default: field?.hidden_at_default ?? false,
    choices_from_provider: field?.choices_from_provider ?? false,
  };
}

function read_one_field(
  name: string,
  property: z.infer<typeof property_schema>,
  required: boolean,
): Omit<SetupField, 'whole_number' | keyof ApiWords> {
  return {
    name,
    description: property.description,
    type: property.type,
    choices: property.enum.length > 0 ? property.enum : null,
    required,
    default_value: property.default ?? null,
    minimum: property.minimum,
    maximum: property.maximum,
    multiple_of: property.multipleOf,
  };
}

function is_integer_type(type: unknown): boolean {
  return type === 'integer' || (Array.isArray(type) && type.includes('integer'));
}

export function validate_setup_number(field: SetupField, value: unknown): string | null {
  if (field.type !== 'number' || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return 'A number';
  if (field.minimum !== null && number < field.minimum) return `At least ${field.minimum}`;
  if (field.maximum !== null && number > field.maximum) return `At most ${field.maximum}`;
  if (field.whole_number && !Number.isInteger(number)) return 'A whole number';
  if (field.multiple_of !== null && !is_multiple_of(number, field.multiple_of)) {
    return `In steps of ${field.multiple_of}`;
  }
  return null;
}

export function validate_setup_value(field: SetupField, value: unknown): string | null {
  if (field.required && is_blank(value) && !field.has_default) return 'Required';
  return validate_setup_number(field, value);
}

export function is_blank(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

function is_multiple_of(number: number, step: number): boolean {
  const ratio = number / step;
  return Math.abs(ratio - Math.round(ratio)) < 1e-9;
}
