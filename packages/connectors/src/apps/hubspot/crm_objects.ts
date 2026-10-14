import type { JsonSchema } from '@coworker/shared';

const hubspot_batch_size = 100;

export type HubspotWritableProperties = Record<string, string | number | boolean | null>;

export type HubspotRecord = {
  id: string;
  properties?: Record<string, unknown> | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  archived?: boolean | null;
};

export type HubspotRecordOutput = {
  id: string;
  properties: Record<string, unknown>;
  created_at: string | null;
  updated_at: string | null;
  archived: boolean;
};

export function to_record_output(record: HubspotRecord): HubspotRecordOutput {
  return {
    id: record.id,
    properties: record.properties ?? {},
    created_at: record.createdAt ?? null,
    updated_at: record.updatedAt ?? null,
    archived: record.archived ?? false,
  };
}

export type HubspotBatchResponse = {
  status?: string | null;
  results?: HubspotRecord[] | null;
  numErrors?: number | null;
  errors?:
    | {
        status?: string | null;
        category?: string | null;
        message?: string | null;
        context?: Record<string, unknown> | null;
      }[]
    | null;
};

export type HubspotPageResponse = {
  total?: number | null;
  results?: HubspotRecord[] | null;
  paging?: { next?: { after?: string | null; link?: string | null } | null } | null;
};

export function to_next_cursor(response: HubspotPageResponse) {
  return response.paging?.next?.after ?? null;
}

export function describe_batch_errors(response: HubspotBatchResponse) {
  const messages = (response.errors ?? []).map(
    (entry) => entry.message ?? entry.category ?? 'error',
  );
  return messages.length > 0 ? messages.join('; ') : 'HubSpot reported no detail for this batch.';
}

export function read_response_schema(definition_response_schemas: unknown, purpose: string) {
  const schemas = definition_response_schemas as Record<string, JsonSchema>;
  const schema = schemas[purpose];
  if (!schema) throw new Error(`node.json has no response_schemas.${purpose}`);
  return schema;
}

export type HubspotChunk<TItem> = {
  start_index: number;
  items: readonly TItem[];
};

export function cut_into_batch_chunks<TItem>(items: readonly TItem[]): HubspotChunk<TItem>[] {
  const chunks: HubspotChunk<TItem>[] = [];
  for (let start_index = 0; start_index < items.length; start_index += hubspot_batch_size) {
    chunks.push({ start_index, items: items.slice(start_index, start_index + hubspot_batch_size) });
  }
  return chunks;
}

export type HubspotItemResult =
  | { index: number; ok: true; record: HubspotRecordOutput }
  | { index: number; ok: false; error: string };

export function failed_chunk_results(
  chunk: HubspotChunk<unknown>,
  message: string,
): HubspotItemResult[] {
  return chunk.items.map((_item, offset) => ({
    index: chunk.start_index + offset,
    ok: false,
    error: message,
  }));
}

export function count_outcomes(results: readonly HubspotItemResult[]) {
  const succeeded = results.filter((result) => result.ok).length;
  return { succeeded, failed: results.length - succeeded };
}
