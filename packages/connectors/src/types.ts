import type { ConnectorRelationRecord } from '@connectors/relation_families';
import type { ConnectorSync } from '@connectors/sync_types';
import type { JsonSchema, Logger } from '@coworker/shared';

export type ConnectorRateLimits = {
  rpm: number;
  concurrency: number;
  burst: number;
};

type ConnectorAuth = {
  kind: 'oauth2' | 'api_key' | 'none';
  auth_url?: string;
  token_url?: string;
  scopes?: readonly string[];
  authorization_params?: Record<string, string>;
  token_auth_method?: 'client_secret_post' | 'client_secret_basic';
  token_request_format?: 'form' | 'json';
  scope_separator?: 'space' | 'comma';
};

type ConnectorAppAvailability = {
  status: 'held';
  reason: string;
};

export type ConnectorApp = {
  app_key: string;
  display_name: string;
  base_url: string;
  rate_limits: ConnectorRateLimits;
  auth: ConnectorAuth;
  sync?: ConnectorSync;
  hidden?: boolean;
  availability?: ConnectorAppAvailability;
  relation_records?: readonly ConnectorRelationRecord[];
};

export type ConnectorConnectionReference = {
  connection_id: string;
  instance_url?: string;
};

export type ConnectorConnection = ConnectorConnectionReference & {
  access_token: string;
};

export type ConnectorHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type ConnectorQuery = Record<string, unknown>;

export type ConnectorResponseFormat = 'json' | 'text';

export type ConnectorValueExpression = unknown;

type ConnectorPagination = {
  cursor_query_parameter: string;
  cursor_from_input: ConnectorValueExpression;
  limit_query_parameter?: string;
  limit_from_input?: ConnectorValueExpression;
};

export type ConnectorHttpMapping = {
  method: ConnectorHttpMethod;
  path: string;
  query?: Record<string, ConnectorValueExpression>;
  body?: ConnectorValueExpression;
  headers?: Record<string, ConnectorValueExpression>;
  paginate?: ConnectorPagination;
  response_format?: ConnectorResponseFormat;
  response_schema: JsonSchema;
  to_output?: ConnectorValueExpression;
};

export type ConnectorNodeRequest = {
  method: ConnectorHttpMethod;
  path: string;
  query?: ConnectorQuery;
  body?: unknown;
  headers?: Record<string, string>;
  response_format?: ConnectorResponseFormat;
  response_schema: JsonSchema;
};

export type ConnectorHttpResponse<TParsed = unknown> = {
  body: TParsed;
  headers: Record<string, string>;
  status: number;
};

export const connector_error_codes = [
  'unknown_node',
  'invalid_input',
  'invalid_output',
  'invalid_provider_response',
  'unauthorized',
  'rate_limited',
  'provider_error',
  'network_error',
  'cancelled',
  'node_failed',
] as const;

export type ConnectorErrorCode = (typeof connector_error_codes)[number];

export function read_connector_error_code(code: string): ConnectorErrorCode {
  return connector_error_codes.find((known) => known === code) ?? 'provider_error';
}

export type ConnectorError = {
  code: ConnectorErrorCode;
  message: string;
  retryable: boolean;
  retry_after_seconds?: number | null;
};

export type ConnectorResult<TData> =
  | { ok: true; data: TData }
  | { ok: false; error: ConnectorError };

export type ConnectorFanOutItemResult<TResult> =
  | { ok: true; index: number; data: TResult }
  | { ok: false; index: number; error: ConnectorError };

export type ConnectorFanOutInput<TItem, TResult> = {
  items: readonly TItem[];
  limits: ConnectorRateLimits;
  call_one: (item: TItem, index: number) => Promise<TResult>;
  atomic?: boolean;
};

type ConnectorFanOut = <TItem, TResult>(
  input: ConnectorFanOutInput<TItem, TResult>,
) => Promise<ConnectorFanOutItemResult<TResult>[]>;

export type ConnectorNodeContext = {
  app: ConnectorApp;
  connection: ConnectorConnectionReference;
  send_request: <TParsed = unknown>(request: ConnectorNodeRequest) => Promise<TParsed>;
  send_request_for_response: <TParsed = unknown>(
    request: ConnectorNodeRequest,
  ) => Promise<ConnectorHttpResponse<TParsed>>;
  fan_out: ConnectorFanOut;
  log: Logger;
  signal?: AbortSignal | undefined;
};

export type ConnectorExecute<TInput = unknown, TOutput = unknown> = (
  input: TInput,
  context: ConnectorNodeContext,
) => Promise<TOutput>;

type ConnectorImplementation = 'http' | 'execute';

export type ConnectorNode = {
  node_key: string;
  description: string;
  display_name?: string;
  implementation: ConnectorImplementation;
  input_schema: JsonSchema;
  output_schema: JsonSchema;
  http?: ConnectorHttpMapping;
  execute?: ConnectorExecute;
  atomic?: boolean;
  required_scopes?: readonly string[];
  write_capable?: boolean;
};

export type RegisteredConnectorNode = {
  node_key: string;
  app_key: string;
  node_name: string;
  node_version: number;
  app: ConnectorApp;
  node: ConnectorNode;
  source_path: string;
};

export type ConnectorAppModule = {
  source_path: string;
  definition: unknown;
};

export type ConnectorNodeModule = {
  source_path: string;
  definition: unknown;
  execute_module?: unknown;
};
