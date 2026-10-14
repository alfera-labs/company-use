import {
  type McpToolCallResult,
  mcp_tool_call_result_schema,
  mcp_tool_list_result_schema,
  type NormalizedMcpTool,
  normalize_mcp_tools,
} from '@coworker/core/integrations/mcp_tool_schema';
import {
  build_request_context,
  type McpSession,
  read_json_rpc_result,
} from '@runtime-platform/tools/mcp/mcp_session';
import { McpTransportError, send_mcp_request } from '@runtime-platform/tools/mcp/mcp_transport';

const maximum_tool_list_pages = 20;
const maximum_tool_count = 500;

export async function read_mcp_tool_list(session: McpSession): Promise<NormalizedMcpTool[]> {
  const tools: NormalizedMcpTool[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < maximum_tool_list_pages; page += 1) {
    const { response } = await send_mcp_request(build_request_context(session), {
      id: 100 + page,
      method: 'tools/list',
      ...(cursor ? { params: { cursor } } : {}),
    });

    const result = read_json_rpc_result(response, 'tools/list');
    const listed = mcp_tool_list_result_schema.safeParse(result);
    if (!listed.success) {
      throw new McpTransportError('protocol', 'The MCP server sent an unreadable tool list.', {
        page,
        issues: listed.error.issues.slice(0, 3),
      });
    }

    tools.push(...normalize_mcp_tools(listed.data.tools));
    if (tools.length > maximum_tool_count) {
      throw new McpTransportError(
        'protocol',
        `The MCP server advertises more than ${maximum_tool_count} tools, which Alfera will not import.`,
        { listed_tool_count: tools.length },
      );
    }

    cursor = listed.data.nextCursor ?? undefined;
    if (!cursor) return tools;
  }

  throw new McpTransportError(
    'protocol',
    'The MCP server kept paging its tool list without ending.',
    {
      pages_read: maximum_tool_list_pages,
    },
  );
}

const mcp_tool_call_timeout_ms = 110_000;

export async function call_mcp_tool(
  session: McpSession,
  input: { tool_name: string; arguments: Record<string, unknown> },
): Promise<McpToolCallResult> {
  const context = { ...build_request_context(session), timeout_ms: mcp_tool_call_timeout_ms };
  const { response } = await send_mcp_request(context, {
    id: 900,
    method: 'tools/call',
    params: { name: input.tool_name, arguments: input.arguments },
  });

  const result = read_json_rpc_result(response, `tools/call ${input.tool_name}`);
  const parsed = mcp_tool_call_result_schema.safeParse(result);
  if (!parsed.success) {
    throw new McpTransportError('protocol', `${input.tool_name} returned an unreadable result.`, {
      tool_name: input.tool_name,
      issues: parsed.error.issues.slice(0, 3),
    });
  }
  return parsed.data;
}
