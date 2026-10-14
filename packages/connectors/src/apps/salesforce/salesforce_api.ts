import type { ConnectorApp, ConnectorNodeContext, ConnectorNodeRequest } from '@connectors/types';
import type { JsonSchema } from '@coworker/shared';

const salesforce_api_version = 'v61.0';

const salesforce_composite_records_limit = 200;

function is_https_url(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function resolve_salesforce_base_url(context: ConnectorNodeContext): string {
  const { instance_url } = context.connection as { instance_url?: unknown };
  if (!is_https_url(instance_url)) {
    throw new Error(
      `Salesforce connection ${context.connection.connection_id} has no instance_url. Store the instance_url from the OAuth token response on the connection and reconnect.`,
    );
  }
  return instance_url.replace(/\/+$/u, '');
}

export function build_salesforce_path(...segments: readonly string[]): string {
  return ['/services/data', salesforce_api_version, ...segments].join('/');
}

export function send_salesforce_request<TParsed>(
  context: ConnectorNodeContext,
  request: ConnectorNodeRequest,
): Promise<TParsed> {
  const app: ConnectorApp = { ...context.app, base_url: resolve_salesforce_base_url(context) };
  const request_on_this_org: ConnectorNodeRequest & { app: ConnectorApp } = { ...request, app };
  return context.send_request<TParsed>(request_on_this_org);
}

type CompositeResponseEntry = {
  id?: string | null;
  success: boolean;
  errors?:
    | { statusCode?: string | null; message?: string | null; fields?: string[] | null }[]
    | null;
};

type SalesforceRecordError = {
  status_code: string | null;
  message: string | null;
  fields: string[];
};

export type SalesforceRecordResult = {
  index: number;
  id: string | null;
  success: boolean;
  errors: SalesforceRecordError[];
};

export function build_composite_record(
  sobject_type: string,
  fields: Record<string, unknown>,
  id?: string,
) {
  return {
    ...fields,
    attributes: { type: sobject_type },
    ...(id === undefined ? {} : { id }),
  };
}

function chunk_records<TRecord>(records: readonly TRecord[], size: number): TRecord[][] {
  const chunks: TRecord[][] = [];
  for (let start = 0; start < records.length; start += size) {
    chunks.push(records.slice(start, start + size));
  }
  return chunks;
}

function read_composite_results(response: CompositeResponseEntry[], first_index: number) {
  return response.map((entry, offset) => ({
    index: first_index + offset,
    id: entry.id ?? null,
    success: entry.success,
    errors: (entry.errors ?? []).map((error) => ({
      status_code: error.statusCode ?? null,
      message: error.message ?? null,
      fields: error.fields ?? [],
    })),
  }));
}

function build_chunk_failure_results(
  chunk_length: number,
  first_index: number,
  message: string,
): SalesforceRecordResult[] {
  return Array.from({ length: chunk_length }, (_unused, offset) => ({
    index: first_index + offset,
    id: null,
    success: false,
    errors: [{ status_code: null, message, fields: [] }],
  }));
}

export async function write_records_through_composite(
  context: ConnectorNodeContext,
  method: 'POST' | 'PATCH',
  records: readonly Record<string, unknown>[],
  response_schema: JsonSchema,
): Promise<SalesforceRecordResult[]> {
  const chunks = chunk_records(records, salesforce_composite_records_limit);
  const chunk_results = await context.fan_out({
    items: chunks,
    limits: context.app.rate_limits,
    call_one: (chunk) =>
      send_salesforce_request<CompositeResponseEntry[]>(context, {
        method,
        path: build_salesforce_path('composite', 'sobjects'),
        body: { allOrNone: false, records: chunk },
        response_schema,
      }),
  });

  const results: SalesforceRecordResult[] = [];
  for (const [chunk_index, chunk_result] of chunk_results.entries()) {
    const chunk = chunks[chunk_index] ?? [];
    const first_index = chunk_index * salesforce_composite_records_limit;
    results.push(
      ...(chunk_result.ok
        ? read_composite_results(chunk_result.data, first_index)
        : build_chunk_failure_results(chunk.length, first_index, chunk_result.error.message)),
    );
  }
  return results;
}
