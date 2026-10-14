import { describe, expect, it } from 'vitest';
import {
  read_connection_page_names,
  read_mcp_server_address,
} from '@/components/connections/connection_page_names';
import type { Connection } from '@/lib/api/types';

function a_connection(fields: Record<string, unknown>) {
  return { connection_name: null, external_account_name: null, app: null, ...fields } as Connection;
}

const an_mcp_server = a_connection({
  connection_name: 'Keyed',
  app: {
    app_display_name: 'Keyed',
    metadata: {
      provider_configs: [
        {
          provider_key: 'mcp',
          setup_defaults: {
            type: 'streamable_http',
            url: 'http://host.docker.internal:8765/mcp?api_key=a-secret',
          },
        },
      ],
    },
  },
});

describe('the names on the connection page', () => {
  it('says the name of an MCP server once, with its address under the title', () => {
    expect(read_connection_page_names(an_mcp_server)).toEqual({
      app_name: 'Keyed',
      title: 'Keyed',
      breadcrumb: [],
      under_the_title: 'http://host.docker.internal:8765/mcp',
    });
  });

  it('keeps the app, the connection and the account apart when they differ', () => {
    const names = read_connection_page_names(
      a_connection({
        connection_name: 'Sales inbox',
        external_account_name: 'sales@example.com',
        app: { app_display_name: 'Gmail', metadata: {} },
      }),
    );

    expect(names.breadcrumb).toEqual(['Gmail']);
    expect(names.title).toBe('Sales inbox');
    expect(names.under_the_title).toBe('sales@example.com');
  });

  it('shows nothing under the title when it would repeat the title and there is no address', () => {
    const names = read_connection_page_names(
      a_connection({
        connection_name: 'Notion',
        app: { app_display_name: 'Notion', metadata: {} },
      }),
    );

    expect(names.breadcrumb).toEqual([]);
    expect(names.under_the_title).toBeNull();
  });

  it('shows nothing under the title when it would repeat the app of the breadcrumb', () => {
    const names = read_connection_page_names(
      a_connection({
        connection_name: 'Sales inbox',
        app: { app_display_name: 'Gmail', metadata: {} },
      }),
    );

    expect(names.breadcrumb).toEqual(['Gmail']);
    expect(names.under_the_title).toBeNull();
  });

  it('shows the server address with no query, which can hold a key', () => {
    expect(read_mcp_server_address(an_mcp_server)).toBe('http://host.docker.internal:8765/mcp');
    expect(read_mcp_server_address(a_connection({ app: { metadata: {} } }))).toBeNull();
    expect(read_mcp_server_address(a_connection({}))).toBeNull();
  });
});
