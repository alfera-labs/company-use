import definition from '@connectors/apps/salesforce/query_records/v1/node.json' with {
  type: 'json',
};
import {
  build_salesforce_path,
  send_salesforce_request,
} from '@connectors/apps/salesforce/salesforce_api';
import { define_connector_execute } from '@connectors/define_connector_execute';
import type { ConnectorNodeContext } from '@connectors/types';
import type { JsonSchema } from '@coworker/shared';

export type QueryRecordsInput = {
  soql: string;
  cursor?: string | undefined;
};

export type QueryRecordsOutput = {
  records: Record<string, unknown>[];
  next_cursor: string | null;
  done: boolean;
  total_size: number | null;
};

type QueryResponse = {
  totalSize?: number | null;
  done: boolean;
  records?: Record<string, unknown>[] | null;
  nextRecordsUrl?: string | null;
};

const response_schema = definition.requests.query_page.response_schema as JsonSchema;

const locator_pattern = /^[A-Za-z0-9_-]+$/u;

function read_next_cursor(next_records_url: string | null | undefined) {
  if (!next_records_url) return null;
  const locator = next_records_url.split('/').pop() ?? '';
  return locator_pattern.test(locator) ? locator : null;
}

export async function query_salesforce_records(
  input: QueryRecordsInput,
  context: ConnectorNodeContext,
): Promise<QueryRecordsOutput> {
  if (input.cursor !== undefined && !locator_pattern.test(input.cursor)) {
    throw new Error(`Salesforce query cursor is not a page locator: ${input.cursor}`);
  }
  const response = await send_salesforce_request<QueryResponse>(context, {
    method: 'GET',
    path:
      input.cursor === undefined
        ? build_salesforce_path('query')
        : build_salesforce_path('query', input.cursor),
    ...(input.cursor === undefined ? { query: { q: input.soql } } : {}),
    response_schema,
  });
  return {
    records: response.records ?? [],
    next_cursor: read_next_cursor(response.nextRecordsUrl),
    done: response.done,
    total_size: response.totalSize ?? null,
  };
}

export const execute = define_connector_execute(query_salesforce_records);
