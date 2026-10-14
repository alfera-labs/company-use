import {
  build_composite_record,
  type SalesforceRecordResult,
  write_records_through_composite,
} from '@connectors/apps/salesforce/salesforce_api';
import definition from '@connectors/apps/salesforce/update_records/v1/node.json' with {
  type: 'json',
};
import { define_connector_execute } from '@connectors/define_connector_execute';
import type { ConnectorNodeContext } from '@connectors/types';
import type { JsonSchema } from '@coworker/shared';

export type UpdateRecordsInput = {
  records: { sobject_type: string; id: string; fields: Record<string, unknown> }[];
};

export type UpdateRecordsOutput = {
  results: SalesforceRecordResult[];
};

const response_schema = definition.requests.composite_update.response_schema as JsonSchema;

export async function update_salesforce_records(
  input: UpdateRecordsInput,
  context: ConnectorNodeContext,
): Promise<UpdateRecordsOutput> {
  const results = await write_records_through_composite(
    context,
    'PATCH',
    input.records.map((record) =>
      build_composite_record(record.sobject_type, record.fields, record.id),
    ),
    response_schema,
  );
  return { results };
}

export const execute = define_connector_execute(update_salesforce_records);
