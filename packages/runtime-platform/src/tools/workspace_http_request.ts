import type { SessionEnvCommandResult } from '@agent-core/environment';
import type { RuntimeToolContext } from '@agent-core/tools/runtime_tool';
import { require_workspace_environment } from '@runtime-platform/tools/workspace_tool_paths';
import { err, ok_text } from '@runtime-platform/tools/workspace_tool_results';
import { z } from 'zod';

const nonempty_string_schema = z.string().min(1);

export const workspace_http_request_input_schema = z
  .object({
    method: nonempty_string_schema,
    url: nonempty_string_schema,
    headers: z.record(z.string(), z.string()).optional(),
    body: z.string().optional(),
    timeout_ms: z.number().finite().optional(),
  })
  .strict();

type WorkspaceHttpRequestInput = z.infer<typeof workspace_http_request_input_schema>;

type CurlRequest = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | undefined;
  timeout_ms: number;
  boundary: string;
};

const http_request_methods = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);

const forbidden_http_request_headers = new Set([
  'authorization',
  'cookie',
  'proxy-authorization',
  'x-api-key',
]);

export async function execute_workspace_http_request(
  input: WorkspaceHttpRequestInput,
  context: RuntimeToolContext,
) {
  const environment = require_workspace_environment(context);
  const method = input.method.toUpperCase();
  const refusal = http_request_input_refusal(method, input);
  if (refusal) return refusal;

  const request: CurlRequest = {
    method,
    url: input.url,
    headers: input.headers ?? {},
    body: input.body,
    timeout_ms: Math.min(input.timeout_ms ?? 30_000, 60_000),
    boundary: `--coworker-http-${context.tool_call_id}--`,
  };
  const result = await environment.exec?.({
    command: 'curl',
    args: curl_args(request),
    cwd: '.',
    writable_paths: [],
    timeout_ms: request.timeout_ms + 5_000,
    ...(context.signal === undefined ? {} : { signal: context.signal }),
  });

  if (!result) return err('sandbox_unavailable', 'HTTP requests need a workspace sandbox.');
  return http_response_result(result, request);
}

function http_request_input_refusal(method: string, input: WorkspaceHttpRequestInput) {
  if (!http_request_methods.has(method)) {
    return err(
      'invalid_tool_input',
      `method must be one of ${[...http_request_methods].join(', ')}.`,
    );
  }
  if (!/^https?:\/\//iu.test(input.url)) {
    return err('invalid_tool_input', 'url must be absolute and start with http:// or https://.');
  }
  const forbidden_header = Object.keys(input.headers ?? {}).find((name) =>
    forbidden_http_request_headers.has(name.toLowerCase()),
  );
  if (forbidden_header === undefined) return undefined;
  return err(
    'blocked_by_policy',
    `Header ${forbidden_header} is not accepted: credentials are attached at the network edge for connected hosts. Connect the app instead of sending a credential.`,
  );
}

function curl_args(request: CurlRequest) {
  const header_args = Object.entries(request.headers).flatMap(([name, value]) => [
    '-H',
    `${name}: ${value}`,
  ]);
  return [
    '-sS',
    '--location',
    '--max-redirs',
    '5',
    '--max-time',
    String(Math.ceil(request.timeout_ms / 1000)),
    '--max-filesize',
    '5000000',
    '-X',
    request.method,
    ...header_args,
    ...(request.body === undefined ? [] : ['--data-raw', request.body]),
    '-w',
    `\n${request.boundary}\n%{http_code}\n%{content_type}`,
    request.url,
  ];
}

function http_response_result(result: SessionEnvCommandResult, request: CurlRequest) {
  const { method, url, boundary } = request;
  if (result.timed_out)
    return err('timed_out', `${method} ${url} timed out after ${request.timeout_ms}ms.`);
  if (result.exit_code !== 0) {
    return err(
      'http_request_failed',
      result.stderr || result.stdout || `curl exited ${result.exit_code}`,
      {
        command_result: result,
      },
    );
  }

  const boundary_index = (result.stdout ?? '').lastIndexOf(`\n${boundary}\n`);
  if (boundary_index === -1) {
    return err('http_request_failed', 'The response could not be parsed from curl output.', {
      command_result: result,
    });
  }

  const response_body = (result.stdout ?? '').slice(0, boundary_index);
  const [status_line, content_type] = (result.stdout ?? '')
    .slice(boundary_index + boundary.length + 2)
    .split('\n');
  const status = Number(status_line);

  return ok_text(`HTTP ${status} ${content_type ?? ''}\n\n${response_body}`, {
    http_response: { status, content_type: content_type ?? null, method, url },
  });
}
