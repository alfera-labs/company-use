import { z } from 'zod';

export const json_rpc_error_codes = {
  parse_error: -32700,
  invalid_request: -32600,
  method_not_found: -32601,
  invalid_params: -32602,
} as const;

const json_rpc_message_schema = z
  .object({
    jsonrpc: z.literal('2.0'),
    id: z.union([z.string(), z.number()]).nullish(),
    method: z.string().min(1),
    params: z.unknown().optional(),
  })
  .loose();

export type JsonRpcMessage = z.infer<typeof json_rpc_message_schema>;

export type ParsedJsonRpcMessage =
  | { parsed: true; value: JsonRpcMessage }
  | { parsed: false; code: number; message: string };

export async function read_json_rpc_message(request: Request): Promise<ParsedJsonRpcMessage> {
  const body: unknown = await request.json().catch((error: unknown) => {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  });
  if (body === undefined) {
    return {
      parsed: false,
      code: json_rpc_error_codes.parse_error,
      message: 'Request body must be valid JSON',
    };
  }

  const parsed = json_rpc_message_schema.safeParse(body);
  // Batches were removed from MCP in the 2025-06-18 revision, so an array lands here too.
  if (!parsed.success) {
    return {
      parsed: false,
      code: json_rpc_error_codes.invalid_request,
      message: 'Expected a single JSON-RPC 2.0 request object',
    };
  }
  return { parsed: true, value: parsed.data };
}

export function is_notification(message: JsonRpcMessage): boolean {
  return message.id === undefined || message.id === null;
}

export function json_rpc_failure(
  id: string | number | null | undefined,
  code: number,
  message: string,
) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

export class JsonRpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'JsonRpcError';
  }
}
