import app_definition from '@connectors/apps/github/app.json' with { type: 'json' };
import { find_json_schema_violation } from '@connectors/json_schema_validation';
import { fan_out } from '@connectors/runtime/fan_out';
import {
  ConnectorHttpError,
  send_connector_http_request,
  send_connector_http_response,
} from '@connectors/runtime/http_request';
import type {
  ConnectorApp,
  ConnectorConnection,
  ConnectorNodeContext,
  ConnectorNodeRequest,
} from '@connectors/types';
import { create_logger, type JsonSchema } from '@coworker/shared';
import { vi } from 'vitest';

if (app_definition.auth.kind !== 'oauth2') {
  throw new Error('github app.json must declare an oauth2 app.');
}

export const github_app: ConnectorApp = {
  app_key: app_definition.app_key,
  display_name: app_definition.display_name,
  base_url: app_definition.base_url,
  rate_limits: app_definition.rate_limits,
  auth: { ...app_definition.auth, kind: 'oauth2' },
};

const github_test_connection: ConnectorConnection = {
  connection_id: 'conn_github_fixture',
  access_token: 'token_github',
};

function github_node_context(): ConnectorNodeContext {
  const send_request = <TParsed = unknown>(request: ConnectorNodeRequest) =>
    send_connector_http_request<TParsed>({
      app: github_app,
      connection: github_test_connection,
      ...request,
    });

  const send_request_for_response = <TParsed = unknown>(request: ConnectorNodeRequest) =>
    send_connector_http_response<TParsed>({
      app: github_app,
      connection: github_test_connection,
      ...request,
    });

  return {
    app: github_app,
    connection: { connection_id: github_test_connection.connection_id },
    send_request,
    send_request_for_response,
    fan_out,
    log: create_logger('connectors_github_test'),
  };
}

export type GithubNodeDefinition = {
  node_key: string;
  input_schema: unknown;
  output_schema: unknown;
};

export async function run_github_node<TInput, TOutput>(
  definition: GithubNodeDefinition,
  execute: (input: TInput, context: ConnectorNodeContext) => Promise<TOutput>,
  input: unknown,
): Promise<TOutput> {
  const input_violation = find_json_schema_violation(
    definition.input_schema as JsonSchema,
    input,
    'input',
  );
  if (input_violation) {
    throw new ConnectorHttpError(
      'invalid_input',
      `Input failed validation for ${definition.node_key}: ${input_violation}`,
      null,
      false,
    );
  }

  const output = await execute(input as TInput, github_node_context());

  const output_violation = find_json_schema_violation(
    definition.output_schema as JsonSchema,
    output,
    'output',
  );
  if (output_violation) {
    throw new ConnectorHttpError(
      'invalid_output',
      `Output failed validation for ${definition.node_key}: ${output_violation}`,
      null,
      false,
    );
  }
  return output;
}

export type RecordedGithubRequest = {
  url: string;
  method: string;
  body: string | null;
  headers: Record<string, string>;
};

export function github_json_response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function stub_github_fetch(answer: (request: RecordedGithubRequest) => Response) {
  const calls: RecordedGithubRequest[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const request: RecordedGithubRequest = {
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
