import {
  type AttioSingleRecordResponse,
  type AttioWriteResult,
  type AttioWriteValues,
  to_attio_write_result,
} from '@connectors/apps/attio/record_shape';
import node_definition from '@connectors/apps/attio/update_records/v1/node.json' with {
  type: 'json',
};
import type { ConnectorNodeContext } from '@connectors/types';
import type { JsonSchema } from '@coworker/shared';

const single_record_response_schema = node_definition.response_schema as JsonSchema;

export type UpdateRecordsInput = {
  object: string;
  records: { record_id: string; values: AttioWriteValues }[];
  multiselect_mode: 'append' | 'overwrite';
};

const method_by_multiselect_mode = { append: 'PATCH', overwrite: 'PUT' } as const;

export async function execute(
  input: UpdateRecordsInput,
  context: ConnectorNodeContext,
): Promise<{ results: AttioWriteResult[] }> {
  const method = method_by_multiselect_mode[input.multiselect_mode];
  const outcomes = await context.fan_out({
    items: input.records,
    limits: context.app.rate_limits,
    call_one: async (record) => {
      const response = await context.send_request<AttioSingleRecordResponse>({
        method,
        path: `/v2/objects/${encodeURIComponent(input.object)}/records/${encodeURIComponent(record.record_id)}`,
        body: { data: { values: record.values } },
        response_schema: single_record_response_schema,
      });
      return response.data;
    },
  });
  return { results: outcomes.map(to_attio_write_result) };
}
