import { z } from 'zod';

const json_schema_object = z.object({ type: z.string().optional() }).loose();

const mcp_tool_annotations_schema = z
  .object({
    title: z.string().optional(),
    readOnlyHint: z.boolean().optional(),
    destructiveHint: z.boolean().optional(),
    idempotentHint: z.boolean().optional(),
    openWorldHint: z.boolean().optional(),
  })
  .loose();

const mcp_tool_schema = z
  .object({
    name: z.string().min(1),
    title: z.string().optional(),
    description: z.string().optional(),
    inputSchema: json_schema_object.optional(),
    outputSchema: json_schema_object.optional(),
    annotations: mcp_tool_annotations_schema.optional(),
  })
  .loose();

export const mcp_tool_list_result_schema = z
  .object({
    tools: z.array(mcp_tool_schema),
    nextCursor: z.string().min(1).nullish(),
  })
  .loose();

const mcp_content_block_schema = z
  .object({ type: z.string().min(1), text: z.string().optional() })
  .loose();

export const mcp_tool_call_result_schema = z
  .object({
    content: z.array(mcp_content_block_schema).default([]),
    structuredContent: z.unknown().optional(),
    isError: z.boolean().default(false),
  })
  .loose();

export const mcp_initialize_result_schema = z
  .object({
    protocolVersion: z.string().min(1),
    capabilities: z.object({}).loose().default({}),
    serverInfo: z
      .object({
        name: z.string().optional(),
        title: z.string().optional(),
        version: z.string().optional(),
        description: z.string().optional(),
        websiteUrl: z.string().optional(),
        icons: z.array(z.object({ src: z.string() }).loose()).optional(),
      })
      .loose()
      .default({}),
    instructions: z.string().optional(),
  })
  .loose();

export const json_rpc_response_schema = z
  .object({
    jsonrpc: z.literal('2.0'),
    id: z.union([z.string(), z.number(), z.null()]).optional(),
    result: z.unknown().optional(),
    error: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.unknown().optional(),
      })
      .loose()
      .optional(),
  })
  .loose();

export type McpTool = z.infer<typeof mcp_tool_schema>;
export type McpToolCallResult = z.infer<typeof mcp_tool_call_result_schema>;
export type McpInitializeResult = z.infer<typeof mcp_initialize_result_schema>;
export type JsonRpcResponse = z.infer<typeof json_rpc_response_schema>;

export type NormalizedMcpTool = {
  tool_name: string;
  display_name: string;
  description: string | null;
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown> | null;
  annotations: {
    read_only: boolean | null;
    destructive: boolean | null;
  };
};

const empty_input_schema = { type: 'object', properties: {} } as const;

export type McpServerIdentity = {
  name: string | null;
  description: string | null;
  icon_url: string | null;
  website_url: string | null;
};

export function normalize_mcp_server_identity(
  server_info: McpInitializeResult['serverInfo'],
): McpServerIdentity {
  return {
    name: server_info.title?.trim() || server_info.name?.trim() || null,
    description: server_info.description?.trim() || null,
    icon_url: server_info.icons?.[0]?.src ?? null,
    website_url: server_info.websiteUrl ?? null,
  };
}

export function normalize_mcp_tools(tools: readonly McpTool[]): NormalizedMcpTool[] {
  return tools.map((tool) => ({
    tool_name: tool.name,
    display_name: tool.title?.trim() || tool.name,
    description: tool.description?.trim() || null,
    input_schema: tool.inputSchema ?? { ...empty_input_schema },
    output_schema: tool.outputSchema ?? null,
    annotations: {
      read_only: tool.annotations?.readOnlyHint ?? null,
      destructive: tool.annotations?.destructiveHint ?? null,
    },
  }));
}
