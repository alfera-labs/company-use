import definition from '@connectors/apps/salesforce/create_records/v1/node.json' with {
  type: 'json',
};
import {
  build_composite_record,
  type SalesforceRecordResult,
  write_records_through_composite,
} from '@connectors/apps/salesforce/salesforce_api';
import { define_connector_execute } from '@connectors/define_connector_execute';
import type { ConnectorNodeContext } from '@connectors/types';
import type { JsonSchema } from '@coworker/shared';

export type CreateRecordsInput = {
  records: { sobject_type: string; fields: Record<string, unknown> }[];
};

export type CreateRecordsOutput = {
  results: SalesforceRecordResult[];
};

const response_schema = definition.requests.composite_create.response_schema as JsonSchema;

export async function create_salesforce_records(
  input: CreateRecordsInput,
  context: ConnectorNodeContext,
): Promise<CreateRecordsOutput> {
  const results = await write_records_through_composite(
    context,
    'POST',
    input.records.map((record) => build_composite_record(record.sobject_type, record.fields)),
    response_schema,
  );
  return { results };
}

export const execute = define_connector_execute(create_salesforce_records);
