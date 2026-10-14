import node_definition from '@connectors/apps/attio/list_records/v1/node.json' with {
  type: 'json',
};
import {
  type AttioRecordOutput,
  type AttioRecordPageResponse,
  to_attio_record_output,
} from '@connectors/apps/attio/record_shape';
import type { ConnectorNodeContext } from '@connectors/types';
import type { JsonSchema } from '@coworker/shared';

const record_page_response_schema = node_definition.response_schema as JsonSchema;

export type ListRecordsInput = {
  object: string;
  filter?: Record<string, unknown>;
  sorts?: unknown[];
  cursor?: string;
  limit: number;
};

export type ListRecordsOutput = {
  records: AttioRecordOutput[];
  next_cursor: string | null;
};

function offset_from_cursor(cursor: string | undefined) {
  return cursor ? Number(cursor) : 0;
}

export async function execute(
  input: ListRecordsInput,
  context: ConnectorNodeContext,
): Promise<ListRecordsOutput> {
  const offset = offset_from_cursor(input.cursor);
  const response = await context.send_request<AttioRecordPageResponse>({
    method: 'POST',
    path: `/v2/objects/${encodeURIComponent(input.object)}/records/query`,
    body: {
      ...(input.filter ? { filter: input.filter } : {}),
      ...(input.sorts ? { sorts: input.sorts } : {}),
      limit: input.limit,
      offset,
    },
    response_schema: record_page_response_schema,
  });

  const records = response.data.map(to_attio_record_output);
  return {
    records,
    next_cursor: records.length < input.limit ? null : String(offset + records.length),
  };
}
