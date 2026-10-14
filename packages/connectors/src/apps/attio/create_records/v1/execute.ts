import node_definition from '@connectors/apps/attio/create_records/v1/node.json' with {
  type: 'json',
};
import {
  type AttioSingleRecordResponse,
  type AttioWriteResult,
  type AttioWriteValues,
  to_attio_write_result,
} from '@connectors/apps/attio/record_shape';
import type { ConnectorNodeContext } from '@connectors/types';
import type { JsonSchema } from '@coworker/shared';

const single_record_response_schema = node_definition.response_schema as JsonSchema;

export type CreateRecordsInput = {
  object: string;
  records: { values: AttioWriteValues }[];
};

export async function execute(
  input: CreateRecordsInput,
  context: ConnectorNodeContext,
): Promise<{ results: AttioWriteResult[] }> {
  const outcomes = await context.fan_out({
    items: input.records,
    limits: context.app.rate_limits,
    call_one: async (record) => {
      const response = await context.send_request<AttioSingleRecordResponse>({
        method: 'POST',
        path: `/v2/objects/${encodeURIComponent(input.object)}/records`,
        body: { data: { values: record.values } },
        response_schema: single_record_response_schema,
      });
      return response.data;
    },
  });
  return { results: outcomes.map(to_attio_write_result) };
}
