import { describe, expect, it } from 'vitest';
import {
  can_add_mcp_server,
  find_mcp_header_refusal,
} from '@/components/app/mcp_server_draft_checks';
import {
  count_free_mcp_header_rows,
  type McpServerDraft,
  pick_credential_choice,
  read_mcp_server_draft,
} from '@/components/app/use_mcp_server_addition';
import type { InspectedMcpServer } from '@/lib/api/types';

const draft: McpServerDraft = {
  display_name: '',
  server_url: ' https://notes.example.com/mcp ',
  authentication: 'always',
  oauth_client_mode: 'automatic',
  oauth_client_id: '',
  oauth_client_secret: '',
  api_key: '',
  api_key_header_name: '',
  request_headers: [{ name: '', value: '' }],
};

function inspected(fields: Partial<InspectedMcpServer>): InspectedMcpServer {
  return {
    endpoint_url: 'https://notes.example.com/mcp',
    server_name: null,
    icon_url: null,
    description: null,
    authentication: 'always',
    offers_sign_in: true,
    supports_dynamic_registration: true,
    ...fields,
  };
}

describe('the choice an inspected MCP server points to', () => {
  it.each([
    [{ authentication: 'always', offers_sign_in: true }, 'always'],
    [{ authentication: 'when_asked', offers_sign_in: true }, 'when_asked'],
    [{ authentication: 'always', offers_sign_in: false }, 'api_key'],
    [{ authentication: 'when_asked', offers_sign_in: false }, 'none'],
    [{ authentication: 'none', offers_sign_in: false }, 'none'],
  ] as const)('%o points to %s', (server, choice) => {
    expect(pick_credential_choice(inspected(server))).toBe(choice);
  });
});

describe('what the Add MCP server dialog sends', () => {
  it('sends a sign-in choice as it is, with the client the person registered', () => {
    expect(
      read_mcp_server_draft({
        ...draft,
        display_name: ' Notes ',
        oauth_client_mode: 'own',
        oauth_client_id: ' client-1 ',
      }),
    ).toEqual({
      server_url: 'https://notes.example.com/mcp',
      authentication: 'always',
      display_name: 'Notes',
      oauth_client: { client_id: 'client-1' },
    });
  });

  it('sends no key that was typed and then left for another choice', () => {
    expect(read_mcp_server_draft({ ...draft, authentication: 'none', api_key: 'a-key' })).toEqual({
      server_url: 'https://notes.example.com/mcp',
      authentication: 'none',
    });
  });

  it('does not let a key choice through without a key', () => {
    expect(can_add_mcp_server({ ...draft, authentication: 'api_key' })).toBe(false);
    expect(can_add_mcp_server({ ...draft, authentication: 'api_key', api_key: 'a-key' })).toBe(
      true,
    );
    expect(can_add_mcp_server(draft)).toBe(true);
  });

  it.each([
    [{ request_headers: [{ name: 'host', value: 'x' }] }, 'host'],
    [{ request_headers: [{ name: ' Content-Type ', value: 'x' }] }, 'Content-Type'],
    [{ authentication: 'api_key', api_key: 'k', api_key_header_name: 'Accept' }, 'Accept'],
  ] as const)('does not let a header through that Alfera sets itself: %o', (fields, name) => {
    const with_that_header = { ...draft, authentication: 'none', ...fields } as McpServerDraft;

    expect(find_mcp_header_refusal(with_that_header)).toBe(
      `Alfera sets the ${name} header itself. Take it out of the additional request headers.`,
    );
    expect(can_add_mcp_server(with_that_header)).toBe(false);
    expect(find_mcp_header_refusal({ ...draft, authentication: 'none' })).toBeNull();
  });

  it('never sends more headers than the API takes when the key has a header of its own', () => {
    const four_rows = ['A', 'B', 'C', 'D'].map((name) => ({ name, value: 'v' }));
    const with_named_key: McpServerDraft = {
      ...draft,
      authentication: 'api_key',
      api_key: 'a-key',
      api_key_header_name: 'X-API-Key',
      request_headers: four_rows,
    };

    expect(count_free_mcp_header_rows(with_named_key)).toBe(3);
    expect(read_mcp_server_draft(with_named_key).request_headers).toEqual([
      { name: 'X-API-Key', value: 'a-key' },
      ...four_rows.slice(0, 3),
    ]);
    expect(
      read_mcp_server_draft({ ...with_named_key, api_key_header_name: '' }).request_headers,
    ).toEqual(four_rows);
  });
});
