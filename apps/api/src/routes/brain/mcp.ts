import {
  api_key_can_use_scope,
  assert_api_key_scope,
  authenticate_mcp_caller,
} from '@api/lib/api_key_auth';
import type { ApiEnv } from '@api/lib/context';
import { read_mcp_oauth_settings, resolve_mcp_client_key } from '@api/lib/mcp_oauth';
import { error_body } from '@api/lib/response';
import type { BrainTool } from '@api/routes/brain/brain_tool';
import {
  is_notification,
  JsonRpcError,
  type JsonRpcMessage,
  json_rpc_error_codes,
  json_rpc_failure,
  read_json_rpc_message,
} from '@api/routes/brain/json_rpc';
import { mcp_oauth_routes, sign_in_challenge_header } from '@api/routes/brain/mcp_oauth_metadata';
import { mcp_server_instructions } from '@api/routes/brain/mcp_server_words';
import {
  brain_mcp_tools,
  list_tool_names_the_key_may_call,
  renamed_mcp_tool_names,
  retired_mcp_tools,
} from '@api/routes/brain/mcp_tools';
import { assert_alfera_api_tool_allowed } from '@api/services/policies/alfera_api_tool_gate';
import type { Database } from '@coworker/core/db/connection';
import type { ApiKey } from '@coworker/core/db/queries/api_keys';
import { AppError, create_logger } from '@coworker/shared';
import { type Context, Hono } from 'hono';
import { z } from 'zod';

const log = create_logger('brain_mcp');

const server_name = 'alfera-brain';
const server_version = '1';
const latest_protocol_version = '2025-06-18';
const supported_protocol_versions = ['2025-06-18', '2025-03-26', '2024-11-05'];

const initialize_params_schema = z.object({ protocolVersion: z.string().optional() }).loose();

const tool_call_params_schema = z
  .object({ name: z.string().min(1), arguments: z.unknown().optional() })
  .loose();

type McpCall = { db: Database; api_key: ApiKey; signal: AbortSignal; params: unknown };

const mcp_methods: Record<string, (call: McpCall) => Promise<unknown>> = {
  initialize: async (call) => describe_server(call.params),
  ping: async () => ({}),
  'notifications/initialized': async () => ({}),
  'tools/list': async (call) => ({ tools: list_allowed_tools(call.api_key) }),
  'tools/call': call_brain_tool,
};

export const brain_mcp_routes = new Hono<ApiEnv>()
  .route('/', mcp_oauth_routes)
  .post('/v1/mcp', run_mcp_request)
  // This server has no server-to-client stream and no session to end, so the other two verbs of
  // Streamable HTTP are answered honestly instead of looking like a missing route.
  .on(['GET', 'DELETE'], '/v1/mcp', (c) =>
    c.json(error_body('method_not_allowed', 'The MCP endpoint accepts POST only'), 405),
  );

async function run_mcp_request(c: Context<ApiEnv>) {
  const db = c.get('db');
  const api_key = await authenticate_mcp_caller(c, resolve_signed_in_client_key).catch(
    (error: unknown) => {
      if (error instanceof AppError && error.status === 401) {
        c.header('WWW-Authenticate', sign_in_challenge_header());
      }
      throw error;
    },
  );
  const message = await read_json_rpc_message(c.req.raw);
  if (!message.parsed) return c.json(json_rpc_failure(null, message.code, message.message), 400);

  if (is_notification(message.value)) return c.body(null, 202);
  return c.json(
    await answer_json_rpc_request({ db, api_key, signal: c.req.raw.signal }, message.value),
  );
}

function resolve_signed_in_client_key(db: Database, token: string) {
  return resolve_mcp_client_key(db, token, read_mcp_oauth_settings());
}

async function answer_json_rpc_request(deps: Omit<McpCall, 'params'>, message: JsonRpcMessage) {
  const method = mcp_methods[message.method];
  if (!method) {
    const code = json_rpc_error_codes.method_not_found;
    return json_rpc_failure(message.id, code, `Unknown method: ${message.method}`);
  }

  try {
    const result = await method({ ...deps, params: message.params });
    return { jsonrpc: '2.0', id: message.id, result };
  } catch (error) {
    if (error instanceof JsonRpcError)
      return json_rpc_failure(message.id, error.code, error.message);
    throw error;
  }
}

async function call_brain_tool(call: McpCall) {
  const requested = tool_call_params_schema.safeParse(call.params);
  if (!requested.success) {
    throw new JsonRpcError(json_rpc_error_codes.invalid_params, 'tools/call needs a tool name');
  }

  const { tool_name, tool, is_retired } = find_called_tool(requested.data.name);
  if (!tool) {
    throw new JsonRpcError(
      json_rpc_error_codes.invalid_params,
      `Unknown tool: ${requested.data.name}`,
    );
  }

  try {
    if (tool.required_scope) assert_api_key_scope(call.api_key, tool.required_scope);
    if (!is_retired) await assert_alfera_api_tool_allowed(call.db, call.api_key, tool_name);
    const result = await tool.run(call.db, call.api_key, requested.data.arguments, call.signal);
    return tool_result(result, false);
  } catch (error) {
    return tool_result(public_tool_error(error, tool_name), true);
  }
}

function find_called_tool(called_name: string) {
  const tool_name = own_value(renamed_mcp_tool_names, called_name) ?? called_name;
  const retired_tool = own_value(retired_mcp_tools, tool_name);
  const tool = own_value(brain_mcp_tools, tool_name) ?? retired_tool;
  return { tool_name, tool, is_retired: tool !== undefined && tool === retired_tool };
}

function own_value<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function list_allowed_tools(api_key: ApiKey) {
  const allowed = new Set(list_tool_names_the_key_may_call(api_key));
  return Object.entries(brain_mcp_tools)
    .filter(([name]) => allowed.has(name))
    .map(([name, tool]) => ({
      name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.json_schema,
      annotations: tool.annotations,
    }));
}

function describe_server(params: unknown) {
  const requested = initialize_params_schema.safeParse(params);
  const asked_for = requested.success ? requested.data.protocolVersion : undefined;
  return {
    protocolVersion:
      asked_for && supported_protocol_versions.includes(asked_for)
        ? asked_for
        : latest_protocol_version,
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: server_name, version: server_version },
    instructions: mcp_server_instructions,
  };
}

function tool_result(payload: unknown, is_error: boolean) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    isError: is_error,
  };
}

function public_tool_error(error: unknown, tool_name: string) {
  if (error instanceof AppError) {
    return { error: error.code, message: error.message, http_status: error.status };
  }
  log.error('mcp tool failed', { tool_name, error });
  return { error: 'internal_error', message: 'An unexpected error occurred', http_status: 500 };
}
