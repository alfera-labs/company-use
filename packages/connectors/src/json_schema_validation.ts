import { json_schema_formats } from '@connectors/json_schema_formats';
import type { JsonSchema } from '@coworker/shared';
import { Ajv2020, type SchemaObject, type ValidateFunction } from 'ajv/dist/2020.js';

const validator = new Ajv2020({ strict: false, allErrors: true, formats: json_schema_formats });

const compiled_schemas = new WeakMap<object, ValidateFunction>();

export function compile_json_schema(schema: JsonSchema): ValidateFunction {
  const existing = compiled_schemas.get(schema);
  if (existing) return existing;
  const validate = validator.compile(schema as SchemaObject);
  compiled_schemas.set(schema, validate);
  return validate;
}

export function find_json_schema_violation(
  schema: JsonSchema,
  value: unknown,
  value_name: string,
): string | null {
  const validate = compile_json_schema(schema);
  if (validate(value)) return null;
  return validator.errorsText(validate.errors, { dataVar: value_name });
}
