import definition from '@connectors/apps/hubspot/create_records/v1/node.json' with { type: 'json' };
import {
  count_outcomes,
  cut_into_batch_chunks,
  describe_batch_errors,
  failed_chunk_results,
  type HubspotBatchResponse,
  type HubspotChunk,
  type HubspotItemResult,
  type HubspotRecordOutput,
  type HubspotWritableProperties,
  read_response_schema,
  to_record_output,
} from '@connectors/apps/hubspot/crm_objects';
import { define_connector_execute } from '@connectors/define_connector_execute';

const batch_create_schema = read_response_schema(definition.response_schemas, 'batch_create');

type CreateRecordInput = { properties: HubspotWritableProperties };

export type CreateRecordsInput = {
  object_type: string;
  records: CreateRecordInput[];
};

export type CreateRecordsOutput = {
  results: HubspotItemResult[];
  created_count: number;
  failed_count: number;
  unmapped_records: HubspotRecordOutput[];
};

type ChunkOutcome = {
  results: HubspotItemResult[];
  unmapped_records: HubspotRecordOutput[];
};

function map_chunk_onto_inputs(
  chunk: HubspotChunk<CreateRecordInput>,
  response: HubspotBatchResponse,
): ChunkOutcome {
  const created = response.results ?? [];
  if (created.length === chunk.items.length && (response.errors ?? []).length === 0) {
    return {
      results: created.map((record, offset) => ({
        index: chunk.start_index + offset,
        ok: true,
        record: to_record_output(record),
      })),
      unmapped_records: [],
    };
  }
  return {
    results: failed_chunk_results(
      chunk,
      `HubSpot created ${created.length} of ${chunk.items.length} records in this batch and does not say which: ${describe_batch_errors(response)}`,
    ),
    unmapped_records: created.map(to_record_output),
  };
}

export const execute = define_connector_execute<CreateRecordsInput, CreateRecordsOutput>(
  async (input, context) => {
    const chunks = cut_into_batch_chunks(input.records);
    const chunk_results = await context.fan_out({
      items: chunks,
      limits: context.app.rate_limits,
      call_one: (chunk) =>
        context.send_request<HubspotBatchResponse>({
          method: 'POST',
          path: `/crm/v3/objects/${encodeURIComponent(input.object_type)}/batch/create`,
          body: { inputs: chunk.items.map((record) => ({ properties: record.properties })) },
          response_schema: batch_create_schema,
        }),
    });

    const outcomes = chunk_results.map((chunk_result) => {
      const chunk = chunks[chunk_result.index] as HubspotChunk<CreateRecordInput>;
      return chunk_result.ok
        ? map_chunk_onto_inputs(chunk, chunk_result.data)
        : {
            results: failed_chunk_results(chunk, chunk_result.error.message),
            unmapped_records: [],
          };
    });

    const results = outcomes.flatMap((outcome) => outcome.results);
    const counts = count_outcomes(results);
    return {
      results,
      created_count: counts.succeeded,
      failed_count: counts.failed,
      unmapped_records: outcomes.flatMap((outcome) => outcome.unmapped_records),
    };
  },
);
