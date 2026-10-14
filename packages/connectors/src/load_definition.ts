import {
  connector_app_definition_schema,
  connector_node_definition_schema,
} from '@connectors/connector_definition_schema';
import {
  compile_json_schema,
  find_json_schema_violation,
} from '@connectors/json_schema_validation';
import { check_sync_objects } from '@connectors/sync_definition/check_sync_objects';
import type {
  ConnectorApp,
  ConnectorExecute,
  ConnectorHttpMapping,
  ConnectorNode,
} from '@connectors/types';
import { evaluate_value_expression } from '@connectors/value_expression';
import type { JsonSchema } from '@coworker/shared';
import { format_error_message } from '@coworker/shared';

export function load_connector_app(source_path: string, definition: unknown): ConnectorApp {
  const violation = find_json_schema_violation(
    connector_app_definition_schema,
    definition,
    'app.json',
  );
  if (violation) throw new Error(`Connector app.json is invalid: ${source_path}: ${violation}`);
  const app = definition as ConnectorApp;
  check_sync_dimensions(app, source_path);
  check_sync_objects(app, source_path);
  return app;
}

function check_sync_dimensions(app: ConnectorApp, source_path: string) {
  const seen = new Set<string>();
  for (const dimension of app.sync?.dimensions ?? []) {
    if (seen.has(dimension.key)) {
      throw new Error(
        `Connector app declares the sync dimension ${dimension.key} twice: ${source_path}`,
      );
    }
    seen.add(dimension.key);
    if (!dimension.option_mapping) continue;
    try {
      evaluate_value_expression(dimension.option_mapping, { item: {} });
    } catch (error) {
      throw new Error(
        `Connector sync dimension ${dimension.key} has a malformed option_mapping: ${source_path}: ${format_error_message(error)}`,
      );
    }
  }
}

function find_execute_export(execute_module: unknown, source_path: string): ConnectorExecute {
  const exported = execute_module as { default?: unknown; execute?: unknown } | undefined;
  const candidate = exported?.default ?? exported?.execute;
  if (typeof candidate !== 'function') {
    throw new Error(
      `Connector execute.ts must export an execute function, as default or named: ${source_path}`,
    );
  }
  return candidate as ConnectorExecute;
}

function resolve_implementation(
  definition: { implementation?: unknown; http?: unknown },
  has_execute_module: boolean,
  source_path: string,
) {
  const declared = definition.implementation;
  const implementation = declared ?? (definition.http ? 'http' : 'execute');
  if (implementation === 'http') {
    if (!definition.http) {
      throw new Error(
        `Connector node declares implementation "http" but has no http: ${source_path}`,
      );
    }
    if (has_execute_module) {
      throw new Error(
        `Connector node declares implementation "http" but its folder has an execute.ts: ${source_path}`,
      );
    }
    return 'http' as const;
  }
  if (definition.http) {
    throw new Error(
      `Connector node declares implementation "execute" but also has an http mapping: ${source_path}. Move a documentary call list to a "requests" quirk key.`,
    );
  }
  if (!has_execute_module) {
    throw new Error(`Connector node has neither an http mapping nor an execute.ts: ${source_path}`);
  }
  return 'execute' as const;
}

export function load_connector_node(
  source_path: string,
  definition: unknown,
  execute_module?: unknown,
): ConnectorNode {
  const violation = find_json_schema_violation(
    connector_node_definition_schema,
    definition,
    'node.json',
  );
  if (violation) throw new Error(`Connector node.json is invalid: ${source_path}: ${violation}`);

  const record = definition as {
    implementation?: unknown;
    http?: ConnectorHttpMapping;
    input_schema: JsonSchema;
    output_schema: JsonSchema;
  };
  const implementation = resolve_implementation(record, execute_module !== undefined, source_path);

  compile_node_schemas(record, source_path);

  const { execute: _declared, ...rest } = definition as ConnectorNode;
  return {
    ...rest,
    implementation,
    ...(implementation === 'execute'
      ? { execute: find_execute_export(execute_module, source_path) }
      : {}),
  };
}

function compile_node_schemas(
  record: { http?: ConnectorHttpMapping; input_schema: JsonSchema; output_schema: JsonSchema },
  source_path: string,
) {
  const schemas: [string, JsonSchema][] = [
    ['input_schema', record.input_schema],
    ['output_schema', record.output_schema],
    ...(record.http
      ? [['http.response_schema', record.http.response_schema] as [string, JsonSchema]]
      : []),
  ];
  for (const [name, schema] of schemas) {
    try {
      compile_json_schema(schema);
    } catch (error) {
      throw new Error(
        `Connector node ${name} is not a valid JSON Schema: ${source_path}: ${format_error_message(error)}`,
      );
    }
  }
}
