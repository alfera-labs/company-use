import {
  cut_into_batch_chunks,
  describe_batch_errors,
  type HubspotBatchResponse,
  type HubspotPageResponse,
  type HubspotRecordOutput,
  read_response_schema,
  to_next_cursor,
  to_record_output,
} from '@connectors/apps/hubspot/crm_objects';
import definition from '@connectors/apps/hubspot/list_records/v1/node.json' with { type: 'json' };
import { define_connector_execute } from '@connectors/define_connector_execute';
import type { ConnectorNodeContext } from '@connectors/types';

const batch_read_schema = read_response_schema(definition.response_schemas, 'batch_read');
const list_schema = read_response_schema(definition.response_schemas, 'list');

export type ListRecordsInput = {
  object_type: string;
  ids?: string[];
  id_property?: string;
  properties?: string[];
  cursor?: string;
  limit?: number;
};

export type ListRecordsOutput = {
  mode: 'batch_read' | 'list';
  records: HubspotRecordOutput[];
  next_cursor: string | null;
  errors: string[];
};

async function read_records_by_id(
  input: ListRecordsInput,
  context: ConnectorNodeContext,
): Promise<ListRecordsOutput> {
  const chunks = cut_into_batch_chunks(input.ids ?? []);
  const chunk_results = await context.fan_out({
    items: chunks,
    limits: context.app.rate_limits,
    call_one: (chunk) =>
      context.send_request<HubspotBatchResponse>({
        method: 'POST',
        path: `/crm/v3/objects/${encodeURIComponent(input.object_type)}/batch/read`,
        body: {
          inputs: chunk.items.map((id) => ({ id })),
          ...(input.properties === undefined ? {} : { properties: input.properties }),
          ...(input.id_property === undefined ? {} : { idProperty: input.id_property }),
        },
        response_schema: batch_read_schema,
      }),
  });

  const records: HubspotRecordOutput[] = [];
  const errors: string[] = [];
  for (const chunk_result of chunk_results) {
    if (!chunk_result.ok) {
      errors.push(chunk_result.error.message);
      continue;
    }
    records.push(...(chunk_result.data.results ?? []).map(to_record_output));
    if ((chunk_result.data.errors ?? []).length > 0) {
      errors.push(describe_batch_errors(chunk_result.data));
    }
  }
  return { mode: 'batch_read', records, next_cursor: null, errors };
}

async function list_one_page(
  input: ListRecordsInput,
  context: ConnectorNodeContext,
): Promise<ListRecordsOutput> {
  const response = await context.send_request<HubspotPageResponse>({
    method: 'GET',
    path: `/crm/v3/objects/${encodeURIComponent(input.object_type)}`,
    query: {
      ...(input.properties === undefined ? {} : { properties: input.properties.join(',') }),
      ...(input.cursor === undefined ? {} : { after: input.cursor }),
      ...(input.limit === undefined ? {} : { limit: input.limit }),
    },
    response_schema: list_schema,
  });
  return {
    mode: 'list',
    records: (response.results ?? []).map(to_record_output),
    next_cursor: to_next_cursor(response),
    errors: [],
  };
}

export const execute = define_connector_execute<ListRecordsInput, ListRecordsOutput>(
  (input, context) =>
    input.ids && input.ids.length > 0
      ? read_records_by_id(input, context)
      : list_one_page(input, context),
);
