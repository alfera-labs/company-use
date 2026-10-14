import { read_response_schema } from '@connectors/apps/hubspot/crm_objects';
import definition from '@connectors/apps/hubspot/list_object_types/v1/node.json' with {
  type: 'json',
};
import type { ConnectorNodeContext } from '@connectors/types';

const custom_schemas_schema = read_response_schema(definition.response_schemas, 'custom_schemas');

export type ListObjectTypesInput = {
  parent_id?: string | undefined;
  query?: string | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
};

type HubspotObjectSchema = {
  name: string;
  objectTypeId?: string | null;
  labels?: { singular?: string | null; plural?: string | null } | null;
  archived?: boolean | null;
};

type CustomSchemasAnswer = {
  results: HubspotObjectSchema[];
};

export type ObjectTypeOption = {
  id: string;
  label: string;
  sublabel?: string;
  kind: string;
  selectable: boolean;
};

export type ListObjectTypesOutput = {
  options: ObjectTypeOption[];
  next_cursor: null;
};

const standard_object_types = definition.standard_object_types;

function to_custom_object_option(schema: HubspotObjectSchema): ObjectTypeOption {
  const id = schema.objectTypeId ?? schema.name;
  const label = schema.labels?.plural ?? schema.labels?.singular ?? schema.name;
  return {
    id,
    label,
    sublabel: schema.name,
    kind: 'custom_object',
    selectable: true,
  };
}

function matches_query(option: ObjectTypeOption, query: string | undefined) {
  if (query === undefined) return true;
  const wanted = query.toLowerCase();
  return (
    option.label.toLowerCase().includes(wanted) ||
    option.id.toLowerCase().includes(wanted) ||
    (option.sublabel ?? '').toLowerCase().includes(wanted)
  );
}

export async function execute(
  input: ListObjectTypesInput,
  context: ConnectorNodeContext,
): Promise<ListObjectTypesOutput> {
  const answer = await context.send_request<CustomSchemasAnswer>({
    method: 'GET',
    path: '/crm/v3/schemas',
    response_schema: custom_schemas_schema,
  });

  const options: ObjectTypeOption[] = [
    ...standard_object_types.map((standard) => ({
      id: standard.id,
      label: standard.label,
      kind: 'object',
      selectable: true,
    })),
    ...answer.results.filter((schema) => schema.archived !== true).map(to_custom_object_option),
  ];

  return {
    options: options.filter((option) => matches_query(option, input.query)),
    next_cursor: null,
  };
}
