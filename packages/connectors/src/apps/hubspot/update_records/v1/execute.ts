import {
  count_outcomes,
  cut_into_batch_chunks,
  describe_batch_errors,
  failed_chunk_results,
  type HubspotBatchResponse,
  type HubspotChunk,
  type HubspotItemResult,
  type HubspotWritableProperties,
  read_response_schema,
  to_record_output,
} from '@connectors/apps/hubspot/crm_objects';
import definition from '@connectors/apps/hubspot/update_records/v1/node.json' with { type: 'json' };
import { define_connector_execute } from '@connectors/define_connector_execute';

const batch_update_schema = read_response_schema(definition.response_schemas, 'batch_update');

type UpdateRecordInput = { id: string; properties: HubspotWritableProperties };

export type UpdateRecordsInput = {
  object_type: string;
  records: UpdateRecordInput[];
  id_property?: string;
};

export type UpdateRecordsOutput = {
  results: HubspotItemResult[];
  updated_count: number;
  failed_count: number;
};

function map_chunk_onto_inputs(
  chunk: HubspotChunk<UpdateRecordInput>,
  response: HubspotBatchResponse,
): HubspotItemResult[] {
  const updated_by_id = new Map((response.results ?? []).map((record) => [record.id, record]));
  const failure_detail = describe_batch_errors(response);
  return chunk.items.map((item, offset) => {
    const index = chunk.start_index + offset;
    const updated = updated_by_id.get(item.id);
    if (updated) return { index, ok: true, record: to_record_output(updated) };
    return {
      index,
      ok: false,
      error: `HubSpot did not update ${item.id}: ${failure_detail}`,
    };
  });
}

export const execute = define_connector_execute<UpdateRecordsInput, UpdateRecordsOutput>(
  async (input, context) => {
    const chunks = cut_into_batch_chunks(input.records);
    const chunk_results = await context.fan_out({
      items: chunks,
      limits: context.app.rate_limits,
      call_one: (chunk) =>
        context.send_request<HubspotBatchResponse>({
          method: 'POST',
          path: `/crm/v3/objects/${encodeURIComponent(input.object_type)}/batch/update`,
          body: {
            inputs: chunk.items.map((record) => ({ id: record.id, properties: record.properties })),
            ...(input.id_property === undefined ? {} : { idProperty: input.id_property }),
          },
          response_schema: batch_update_schema,
        }),
    });

    const results = chunk_results.flatMap((chunk_result) => {
      const chunk = chunks[chunk_result.index] as HubspotChunk<UpdateRecordInput>;
      return chunk_result.ok
        ? map_chunk_onto_inputs(chunk, chunk_result.data)
        : failed_chunk_results(chunk, chunk_result.error.message);
    });

    const counts = count_outcomes(results);
    return { results, updated_count: counts.succeeded, failed_count: counts.failed };
  },
);
