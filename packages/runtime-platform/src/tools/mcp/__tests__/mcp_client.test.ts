import {
  generate_metadata_urls,
  read_resource_metadata_url,
} from '@coworker/core/integrations/mcp_authorization_discovery';
import {
  build_mcp_node_values,
  calculate_mcp_approval_policy,
  calculate_mcp_tool_digest,
} from '@coworker/core/integrations/mcp_catalog_node_values';
import {
  generate_mcp_server_key,
  list_mcp_server_key_candidates,
} from '@coworker/core/integrations/mcp_server_url';
import {
  mcp_tool_call_result_schema,
  normalize_mcp_tools,
} from '@coworker/core/integrations/mcp_tool_schema';
import { read_mcp_tool_name } from '@runtime-platform/tools/mcp/mcp_executor';
import { McpTransportError, send_mcp_request } from '@runtime-platform/tools/mcp/mcp_transport';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stub_fetch_response(body: string, headers: Record<string, string>, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(body, { status, headers })),
  );
}

describe('streamable HTTP transport', () => {
  it('reads a JSON-RPC response out of an SSE-framed POST body', async () => {
    stub_fetch_response('event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n\n', {
      'content-type': 'text/event-stream',
    });

    const round_trip = await send_mcp_request(
      { endpoint_url: 'https://example.test/mcp', headers: {} },
      { id: 1, method: 'tools/list' },
    );

    expect(round_trip.response.result).toEqual({ ok: true });
  });

  it('takes the last data frame, so progress notifications do not win', async () => {
    stub_fetch_response(
      'event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\n\n' +
        'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"answer":42}}\n\n',
      { 'content-type': 'text/event-stream' },
    );

    const round_trip = await send_mcp_request(
      { endpoint_url: 'https://example.test/mcp', headers: {} },
      { id: 1, method: 'tools/list' },
    );

    expect(round_trip.response.result).toEqual({ answer: 42 });
  });

  it('still reads a plain JSON body', async () => {
    stub_fetch_response('{"jsonrpc":"2.0","id":1,"result":{"plain":true}}', {
      'content-type': 'application/json',
    });

    const round_trip = await send_mcp_request(
      { endpoint_url: 'https://example.test/mcp', headers: {} },
      { id: 1, method: 'tools/list' },
    );

    expect(round_trip.response.result).toEqual({ plain: true });
  });

  it('reports a 401 as unauthorized and keeps the challenge header', async () => {
    stub_fetch_response(
      '{"error":"unauthorized"}',
      {
        'content-type': 'application/json',
        'www-authenticate': 'Bearer resource_metadata="https://example.test/.well-known/x"',
      },
      401,
    );

    const failure = await send_mcp_request(
      { endpoint_url: 'https://example.test/mcp', headers: {} },
      { id: 1, method: 'tools/list' },
    ).catch((error) => error);

    expect(failure).toBeInstanceOf(McpTransportError);
    expect((failure as McpTransportError).kind).toBe('unauthorized');
    expect((failure as McpTransportError).detail?.www_authenticate).toContain('resource_metadata');
  });
});

describe('tool result reading', () => {
  it('defaults isError to false and preserves it when set', () => {
    expect(mcp_tool_call_result_schema.parse({ content: [] }).isError).toBe(false);
    expect(mcp_tool_call_result_schema.parse({ content: [], isError: true }).isError).toBe(true);
  });

  it('keeps content blocks it does not recognise', () => {
    const parsed = mcp_tool_call_result_schema.parse({
      content: [{ type: 'image', data: 'abc', mimeType: 'image/png' }],
    });
    expect(parsed.content[0]).toMatchObject({ type: 'image', data: 'abc' });
  });

  it('accepts unknown top-level fields from a newer server revision', () => {
    expect(() =>
      mcp_tool_call_result_schema.parse({ content: [], somethingNewIn2027: true }),
    ).not.toThrow();
  });
});

describe('runtime handler parsing', () => {
  it('keeps dots inside a tool name', () => {
    expect(read_mcp_tool_name('mcp.linear.list_issues')).toBe('list_issues');
    expect(read_mcp_tool_name('mcp.acme.files.read')).toBe('files.read');
  });

  it('refuses a handler that is not an MCP one', () => {
    expect(read_mcp_tool_name('composio.api_proxy')).toBeNull();
    expect(read_mcp_tool_name('mcp.only_two')).toBeNull();
  });
});

describe('tool normalization', () => {
  it('falls back to the machine name when a server sends no title', () => {
    const [tool] = normalize_mcp_tools([{ name: 'list_issues' }]);
    expect(tool?.display_name).toBe('list_issues');
    expect(tool?.input_schema).toEqual({ type: 'object', properties: {} });
  });

  it('keeps the server inputSchema verbatim', () => {
    const schema = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] };
    const [tool] = normalize_mcp_tools([{ name: 't', inputSchema: schema }]);
    expect(tool?.input_schema).toEqual(schema);
  });
});

describe('approval policy', () => {
  it('ignores a untrusted server claim that a tool is read-only', () => {
    const tool = {
      tool_name: 't',
      display_name: 'T',
      annotations: { read_only: true, destructive: null },
    };
    expect(calculate_mcp_approval_policy(tool, false)).toEqual({ mode: 'manual_review' });
  });

  it('believes an admitted server that a tool is read-only', () => {
    const tool = {
      tool_name: 't',
      display_name: 'T',
      annotations: { read_only: true, destructive: null },
    };
    expect(calculate_mcp_approval_policy(tool, true)).toEqual({ mode: 'none' });
  });

  it('requires review for a destructive tool even on an admitted server', () => {
    const tool = {
      tool_name: 't',
      display_name: 'T',
      annotations: { read_only: true, destructive: true },
    };
    expect(calculate_mcp_approval_policy(tool, true)).toEqual({ mode: 'manual_review' });
  });

  it('requires review when a tool says nothing about itself', () => {
    expect(calculate_mcp_approval_policy({ tool_name: 't', display_name: 'T' }, true)).toEqual({
      mode: 'manual_review',
    });
  });
});

describe('tool digest', () => {
  it('does not depend on JSON key order', () => {
    const left = calculate_mcp_tool_digest({
      tool_name: 't',
      input_schema: { a: 1, b: { c: 2, d: 3 } },
    });
    const right = calculate_mcp_tool_digest({
      tool_name: 't',
      input_schema: { b: { d: 3, c: 2 }, a: 1 },
    });
    expect(left).toBe(right);
  });

  it('changes when the input contract changes', () => {
    const before = calculate_mcp_tool_digest({ tool_name: 't', input_schema: { a: 1 } });
    const after = calculate_mcp_tool_digest({ tool_name: 't', input_schema: { a: 2 } });
    expect(before).not.toBe(after);
  });
});

describe('node values', () => {
  it('gives colliding tool names distinct stable node names', () => {
    const values = build_mcp_node_values({
      app_name: 'mcp_acme',
      server_key: 'acme',
      tools: [
        { tool_name: 'foo-bar', display_name: 'A' },
        { tool_name: 'foo_bar', display_name: 'B' },
      ],
      trust_tool_annotations: false,
    });
    expect(new Set(values.map((value) => value.node_name)).size).toBe(2);
    expect(values.every((value) => value.node_key.length <= 64)).toBe(true);
  });

  it('routes each tool to its own runtime handler', () => {
    const [value] = build_mcp_node_values({
      app_name: 'mcp_acme',
      server_key: 'acme',
      tools: [{ tool_name: 'list_issues', display_name: 'List' }],
      trust_tool_annotations: false,
    });
    expect(value?.runtime_handler).toBe('mcp.acme.list_issues');
  });
});

describe('server key', () => {
  it('names the product, not the protocol subdomain', () => {
    expect(generate_mcp_server_key('https://mcp.linear.app/mcp')).toBe('linear');
    expect(generate_mcp_server_key('https://mcp.notion.com/mcp')).toBe('notion');
    expect(generate_mcp_server_key('https://mcp.mail.superhuman.com/mcp')).toBe('superhuman');
    expect(generate_mcp_server_key('https://api.githubcopilot.com/mcp/')).toBe('githubcopilot');
  });

  it('offers a longer key for a second server on the same domain', () => {
    const billing = list_mcp_server_key_candidates('https://billing.tools.example.com/mcp');
    const reports = list_mcp_server_key_candidates('https://reports.tools.example.com/mcp');

    expect(billing[0]).toBe('example');
    expect(reports[0]).toBe('example');
    expect(billing[1]).toBe('billing_tools_example');
    expect(reports[1]).toBe('reports_tools_example');
  });

  it('tells two servers on one host apart by their address', () => {
    const first = list_mcp_server_key_candidates('https://tools.example.com/billing/mcp');
    const second = list_mcp_server_key_candidates('https://tools.example.com/reports/mcp');

    expect(first.at(-1)).toMatch(/^example_[0-9a-f]{8}$/u);
    expect(first.at(-1)).not.toBe(second.at(-1));
  });
});

describe('authorization discovery inputs', () => {
  it('reads the resource metadata pointer out of a challenge', () => {
    expect(
      read_resource_metadata_url(
        'Bearer realm="OAuth", resource_metadata="https://mcp.linear.app/.well-known/oauth-protected-resource/mcp", error="invalid_token"',
      ),
    ).toBe('https://mcp.linear.app/.well-known/oauth-protected-resource/mcp');
  });

  it('returns null when a server sends no pointer', () => {
    expect(read_resource_metadata_url('Bearer realm="OAuth"')).toBeNull();
    expect(read_resource_metadata_url(null)).toBeNull();
  });

  it('tries both well-known layouts for an issuer with a path', () => {
    expect(generate_metadata_urls('https://github.com/login/oauth')).toEqual([
      'https://github.com/.well-known/oauth-authorization-server/login/oauth',
      'https://github.com/.well-known/openid-configuration/login/oauth',
      'https://github.com/login/oauth/.well-known/oauth-authorization-server',
      'https://github.com/login/oauth/.well-known/openid-configuration',
    ]);
  });

  it('tries both for an issuer with no path', () => {
    expect(generate_metadata_urls('https://mcp.linear.app')).toEqual([
      'https://mcp.linear.app/.well-known/oauth-authorization-server',
      'https://mcp.linear.app/.well-known/openid-configuration',
    ]);
  });
});
