import app_definition from '@connectors/apps/notion/app.json' with { type: 'json' };
import { find_json_schema_violation } from '@connectors/json_schema_validation';
import { load_connector_app } from '@connectors/load_definition';
import { fan_out } from '@connectors/runtime/fan_out';
import {
  send_connector_http_request,
  send_connector_http_response,
} from '@connectors/runtime/http_request';
import type {
  ConnectorConnection,
  ConnectorNodeContext,
  ConnectorNodeRequest,
} from '@connectors/types';
import { create_logger, type JsonSchema } from '@coworker/shared';
import { vi } from 'vitest';

export const notion_app = load_connector_app('apps/notion/app.json', app_definition);

export const notion_test_connection: ConnectorConnection = {
  connection_id: 'conn_notion_fixture',
  access_token: 'token_notion',
};

function notion_node_context(): ConnectorNodeContext {
  return {
    app: notion_app,
    connection: { connection_id: notion_test_connection.connection_id },
    send_request: <TParsed>(request: ConnectorNodeRequest): Promise<TParsed> =>
      send_connector_http_request<TParsed>({
        app: notion_app,
        connection: notion_test_connection,
        ...request,
      }),
    send_request_for_response: <TParsed>(request: ConnectorNodeRequest) =>
      send_connector_http_response<TParsed>({
        app: notion_app,
        connection: notion_test_connection,
        ...request,
      }),
    fan_out,
    log: create_logger('connectors-notion-test'),
  };
}

export type NotionNodeDefinition = {
  input_schema: unknown;
  output_schema: unknown;
};

export async function run_notion_node<TInput, TOutput>(
  definition: NotionNodeDefinition,
  execute: (input: TInput, context: ConnectorNodeContext) => Promise<TOutput>,
  input: unknown,
): Promise<TOutput> {
  const input_violation = find_json_schema_violation(
    definition.input_schema as JsonSchema,
    input,
    'input',
  );
  if (input_violation) throw new Error(`Input failed validation: ${input_violation}`);

  const produced = await execute(input as TInput, notion_node_context());

  const output_violation = find_json_schema_violation(
    definition.output_schema as JsonSchema,
    produced,
    'output',
  );
  if (output_violation) throw new Error(`Output failed validation: ${output_violation}`);
  return produced;
}

export type RecordedNotionRequest = {
  url: string;
  method: string;
  body: string | null;
  headers: Record<string, string>;
};

export function notion_json_response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function stub_notion_fetch(answer: (request: RecordedNotionRequest) => Response) {
  const calls: RecordedNotionRequest[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const request: RecordedNotionRequest = {
        url: String(url),
        method: String(init.method),
        body: typeof init.body === 'string' ? init.body : null,
        headers: (init.headers ?? {}) as Record<string, string>,
      };
      calls.push(request);
      return answer(request);
    }),
  );
  return calls;
}
