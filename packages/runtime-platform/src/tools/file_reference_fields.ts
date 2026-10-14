import type {
  NodeInputSchemaData,
  ToolInputPropertyData,
} from '@coworker/core/db/schema/json_column_types';

export type FileReferenceField = {
  field_name: string;
  accepts_many: boolean;
};

export function list_file_reference_fields(
  schema: Pick<NodeInputSchemaData, 'properties'>,
): FileReferenceField[] {
  const fields: FileReferenceField[] = [];
  for (const [field_name, property] of Object.entries(schema.properties ?? {})) {
    if (typeof property === 'boolean') continue;
    const property_with_field = property as ToolInputPropertyData;
    if (!property_with_field.field?.file_reference) continue;
    fields.push({ field_name, accepts_many: property_with_field.type === 'array' });
  }
  return fields;
}
