import definition from '@connectors/apps/salesforce/list_object_types/v1/node.json' with {
  type: 'json',
};
import { send_salesforce_request } from '@connectors/apps/salesforce/salesforce_api';
import { define_connector_execute } from '@connectors/define_connector_execute';
import type { ConnectorNodeContext } from '@connectors/types';
import type { JsonSchema } from '@coworker/shared';

const describe_global = definition.requests.describe_global;
const describe_global_schema = describe_global.response_schema as JsonSchema;

export type ListObjectTypesInput = {
  parent_id?: string | undefined;
  query?: string | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
};

type SalesforceObjectDescription = {
  name: string;
  label?: string | null;
  queryable?: boolean | null;
  custom?: boolean | null;
  deprecatedAndHidden?: boolean | null;
};

type DescribeGlobalAnswer = {
  sobjects: SalesforceObjectDescription[];
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

const shadow_object_suffixes = ['Share', 'History', 'Feed', 'ChangeEvent'] as const;

function is_pickable_object(description: SalesforceObjectDescription) {
  if (description.queryable !== true) return false;
  if (description.deprecatedAndHidden === true) return false;
  return !shadow_object_suffixes.some((suffix) => description.name.endsWith(suffix));
}

function matches_query(description: SalesforceObjectDescription, query: string | undefined) {
  if (query === undefined) return true;
  const wanted = query.toLowerCase();
  return (
    description.name.toLowerCase().includes(wanted) ||
    (description.label ?? '').toLowerCase().includes(wanted)
  );
}

function to_object_type_option(description: SalesforceObjectDescription): ObjectTypeOption {
  const label = description.label ?? description.name;
  return {
    id: description.name,
    label,
    ...(label === description.name ? {} : { sublabel: description.name }),
    kind: description.custom === true ? 'custom_object' : 'object',
    selectable: true,
  };
}

export async function list_salesforce_object_types(
  input: ListObjectTypesInput,
  context: ConnectorNodeContext,
): Promise<ListObjectTypesOutput> {
  const answer = await send_salesforce_request<DescribeGlobalAnswer>(context, {
    method: 'GET',
    path: describe_global.path,
    response_schema: describe_global_schema,
  });

  return {
    options: answer.sobjects
      .filter(
        (description) => is_pickable_object(description) && matches_query(description, input.query),
      )
      .map(to_object_type_option),
    next_cursor: null,
  };
}

export const execute = define_connector_execute(list_salesforce_object_types);
