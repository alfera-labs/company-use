import { find_json_schema_violation } from '@connectors/json_schema_validation';
import { get_connector_node } from '@connectors/registry';
import { as_connector_error, fan_out } from '@connectors/runtime/fan_out';
import {
  ConnectorHttpError,
  send_connector_http_request,
  send_connector_http_response,
} from '@connectors/runtime/http_request';
import type {
  ConnectorApp,
  ConnectorConnection,
  ConnectorConnectionReference,
  ConnectorHttpMapping,
  ConnectorNode,
  ConnectorNodeContext,
  ConnectorQuery,
  ConnectorResult,
} from '@connectors/types';
import {
  evaluate_expression_record,
  evaluate_value_expression,
  fill_path_template,
  type ValueScope,
} from '@connectors/value_expression';
import { create_logger } from '@coworker/shared';

const log = create_logger('connectors');

const identity_output = { $: 'response' };

export type ExecuteConnectorNodeOptions = {
  signal?: AbortSignal | undefined;
};

function paginated_query(mapping: ConnectorHttpMapping, scope: ValueScope): ConnectorQuery {
  const query = evaluate_expression_record(mapping.query, scope);
  const paginate = mapping.paginate;
  if (!paginate) return query;
  const cursor = evaluate_value_expression(paginate.cursor_from_input, scope);
  if (cursor !== undefined && cursor !== null) query[paginate.cursor_query_parameter] = cursor;
  const limit =
    paginate.limit_from_input === undefined
      ? undefined
      : evaluate_value_expression(paginate.limit_from_input, scope);
  if (limit !== undefined && limit !== null && paginate.limit_query_parameter) {
    query[paginate.limit_query_parameter] = limit;
  }
  return query;
}

function evaluate_headers(mapping: ConnectorHttpMapping, scope: ValueScope) {
  const evaluated = evaluate_expression_record(mapping.headers, scope);
  return Object.fromEntries(
    Object.entries(evaluated).map(([name, value]) => [name, String(value)]),
  );
}

async function run_http_mapping(
  app: ConnectorApp,
  connection: ConnectorConnection,
  mapping: ConnectorHttpMapping,
  input: unknown,
  options: ExecuteConnectorNodeOptions,
) {
  const request_scope: ValueScope = { input };
  const response = await send_connector_http_request({
    app,
    connection,
    method: mapping.method,
    path: fill_path_template(mapping.path, request_scope),
    query: paginated_query(mapping, request_scope),
    ...(mapping.body === undefined
      ? {}
      : { body: evaluate_value_expression(mapping.body, request_scope) }),
    ...(mapping.headers ? { headers: evaluate_headers(mapping, request_scope) } : {}),
    ...(mapping.response_format ? { response_format: mapping.response_format } : {}),
    response_schema: mapping.response_schema,
    signal: options.signal,
  });
  return evaluate_value_expression(mapping.to_output ?? identity_output, { input, response });
}

function connection_reference(connection: ConnectorConnection): ConnectorConnectionReference {
  const { access_token: _token, ...reference } = connection;
  return reference;
}

function build_node_context(
  app: ConnectorApp,
  connection: ConnectorConnection,
  options: ExecuteConnectorNodeOptions,
): ConnectorNodeContext {
  return {
    app,
    connection: connection_reference(connection),
    send_request: (request) =>
      send_connector_http_request({
        app,
        connection,
        ...request,
        signal: options.signal,
      }),
    send_request_for_response: (request) =>
      send_connector_http_response({
        app,
        connection,
        ...request,
        signal: options.signal,
      }),
    fan_out,
    log,
    signal: options.signal,
  };
}

async function run_node_work(
  node: ConnectorNode,
  app: ConnectorApp,
  connection: ConnectorConnection,
  input: unknown,
  options: ExecuteConnectorNodeOptions,
) {
  if (node.implementation === 'http' && node.http) {
    return run_http_mapping(app, connection, node.http, input, options);
  }
  if (node.execute) return node.execute(input, build_node_context(app, connection, options));
  throw new ConnectorHttpError(
    'node_failed',
    `Connector node has neither an http mapping nor an execute.ts: ${node.node_key}`,
    null,
    false,
  );
}

export async function execute_node(
  node_key: string,
  input: unknown,
  connection: ConnectorConnection,
  options: ExecuteConnectorNodeOptions = {},
): Promise<ConnectorResult<unknown>> {
  const registered = get_connector_node(node_key);
  if (!registered) {
    return {
      ok: false,
      error: {
        code: 'unknown_node',
        message: `No connector node named ${node_key}.`,
        retryable: false,
      },
    };
  }

  const input_violation = find_json_schema_violation(registered.node.input_schema, input, 'input');
  if (input_violation) {
    return {
      ok: false,
      error: {
        code: 'invalid_input',
        message: `Input failed validation for ${node_key}: ${input_violation}`,
        retryable: false,
      },
    };
  }

  let produced: unknown;
  try {
    produced = await run_node_work(registered.node, registered.app, connection, input, options);
  } catch (error) {
    const connector_error = as_connector_error(error);
    log.warn(`connector node failed: ${node_key}`, connector_error);
    return { ok: false, error: connector_error };
  }

  const output_violation = find_json_schema_violation(
    registered.node.output_schema,
    produced,
    'output',
  );
  if (output_violation) {
    return {
      ok: false,
      error: {
        code: 'invalid_output',
        message: `Output failed validation for ${node_key}: ${output_violation}`,
        retryable: false,
      },
    };
  }
  return { ok: true, data: produced };
}
