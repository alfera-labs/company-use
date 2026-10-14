import app_definition from '@connectors/apps/hubspot/app.json' with { type: 'json' };
import { find_json_schema_violation } from '@connectors/json_schema_validation';
import { load_connector_app, load_connector_node } from '@connectors/load_definition';
import { fan_out } from '@connectors/runtime/fan_out';
import {
  send_connector_http_request,
  send_connector_http_response,
} from '@connectors/runtime/http_request';
import type {
  ConnectorApp,
  ConnectorConnection,
  ConnectorHttpMapping,
  ConnectorNode,
  ConnectorNodeContext,
  ConnectorNodeRequest,
} from '@connectors/types';
import {
  evaluate_expression_record,
  evaluate_value_expression,
  fill_path_template,
} from '@connectors/value_expression';
import { create_logger, type JsonSchema } from '@coworker/shared';
import { expect, vi } from 'vitest';

export const app: ConnectorApp = load_connector_app('apps/hubspot/app.json', app_definition);

const connection: ConnectorConnection = {
  connection_id: 'conn_hubspot_fixture',
  access_token: 'token_hubspot',
};

export type HubspotCall = {
  method: string;
  url: string;
  path: string;
  body: unknown;
};

export type HubspotAnswer = { status?: number; body: unknown };

export function stub_hubspot_fetch(answer: (call: HubspotCall) => HubspotAnswer) {
  const calls: HubspotCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (target: string | URL, init: RequestInit | undefined) => {
      const url = String(target);
      const call: HubspotCall = {
        method: init?.method ?? 'GET',
        url,
        path: new URL(url).pathname,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      };
      calls.push(call);
      const { status = 200, body } = answer(call);
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
  return calls;
}

export function build_hubspot_context(): ConnectorNodeContext {
  return {
    app,
    connection: { connection_id: connection.connection_id },
    send_request: <TParsed = unknown>(request: ConnectorNodeRequest) =>
      send_connector_http_request({ app, connection, ...request }) as Promise<TParsed>,
    send_request_for_response: (request) =>
      send_connector_http_response({ app, connection, ...request }),
    fan_out,
    log: create_logger('connectors_hubspot_test'),
  };
}

export async function run_http_mapping(mapping: ConnectorHttpMapping, input: unknown) {
  const scope = { input };
  const response = await build_hubspot_context().send_request({
    method: mapping.method,
    path: fill_path_template(mapping.path, scope),
    ...(mapping.query ? { query: evaluate_expression_record(mapping.query, scope) } : {}),
    ...(mapping.body ? { body: evaluate_value_expression(mapping.body, scope) } : {}),
    response_schema: mapping.response_schema,
  });
  return mapping.to_output === undefined
    ? response
    : evaluate_value_expression(mapping.to_output, { input, response });
}

export function load_hubspot_node(
  node_name: string,
  definition: unknown,
  execute_module?: unknown,
): ConnectorNode {
  return load_connector_node(`apps/hubspot/${node_name}/v1/node.json`, definition, execute_module);
}

export type NodeQuirks = {
  endpoints: { purpose: string; method: string; path: string }[];
  response_schemas?: Record<string, JsonSchema>;
  quirks: string[];
};

export function check_node_definition(node: ConnectorNode, expected_node_key: string) {
  const extras = node as unknown as NodeQuirks;
  expect(node.node_key).toBe(expected_node_key);
  expect(node.description.length).toBeGreaterThan(80);
  expect(node.required_scopes?.length ?? 0).toBeGreaterThan(0);
  expect(extras.endpoints.length).toBeGreaterThan(0);
  for (const endpoint of extras.endpoints) {
    expect(endpoint.path.startsWith('/crm/v3/objects/')).toBe(true);
  }
  expect(extras.quirks.length).toBeGreaterThan(0);
  const input_schema = node.input_schema as JsonSchemaObject;
  const object_type = input_schema.properties?.object_type as { pattern?: string };
  expect(object_type.pattern).toBe('^[a-z][a-z0-9_]*$|^\\d+-\\d+$');
  expect(input_schema.required).toContain('object_type');
}

type JsonSchemaObject = {
  $schema?: string;
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
};

export function check_output_against_schema(output: unknown, schema: JsonSchema) {
  expect(find_json_schema_violation(schema, output, 'output')).toBeNull();
}
