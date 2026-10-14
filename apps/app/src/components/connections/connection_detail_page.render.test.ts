import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ConnectionDetailPage } from '@/components/connections/connection_detail_page';
import { query_keys } from '@/lib/api/query_keys';
import type { Connection } from '@/lib/api/types';

vi.mock('@tanstack/react-router', async (import_original) => ({
  ...(await import_original<typeof import('@tanstack/react-router')>()),
  Link: ({ to, children, ...anchor }: { to?: string; children?: ReactNode }) =>
    createElement('a', { ...anchor, href: to }, children),
  useNavigate: () => vi.fn(),
}));

const an_app = (app_display_name: string) => ({
  app_display_name,
  app_name: app_display_name.toLowerCase(),
  metadata: {},
  display_config: { icon_url: 'https://example.com/icon.png' },
});

function a_connection(fields: Record<string, unknown>) {
  return {
    connection_id: 'conn_1',
    connection_name: null,
    external_account_name: null,
    connection_status: 'active',
    created_time: '2026-07-10T09:00:00.000Z',
    permissions: { can_manage: false },
    app: null,
    ...fields,
  } as Connection;
}

function words_on_the_page_of(connection: Connection) {
  const client = new QueryClient();
  client.setQueryData(query_keys.connection(connection.connection_id), connection);
  const page = createElement(ConnectionDetailPage, { connection_id: connection.connection_id });
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, page));
  return html.replace(/<[^>]*>/gu, '\n');
}

const times = (words: string, name: string) => words.split(name).length - 1;

describe('the names a person reads on the connection page', () => {
  it('says the name of an MCP server once, in the title, under a way back to Integrations', () => {
    const words = words_on_the_page_of(
      a_connection({
        connection_name: 'Kettle notes',
        app: an_app('Kettle notes'),
      }),
    );

    expect(times(words, 'Kettle notes')).toBe(1);
    expect(words).toContain('Integrations');
  });

  it('says the app, the connection and the account once each when they differ', () => {
    const words = words_on_the_page_of(
      a_connection({
        connection_name: 'Sales inbox',
        external_account_name: 'sales@example.com',
        app: an_app('Gmail'),
      }),
    );

    expect(times(words, 'Sales inbox')).toBe(1);
    expect(times(words, 'Gmail')).toBe(1);
    expect(words).toContain('sales@example.com');
  });

  it('says the app once when the connection has its own name and no account name', () => {
    const words = words_on_the_page_of(
      a_connection({
        connection_name: 'Sales inbox',
        app: an_app('Gmail'),
      }),
    );

    expect(times(words, 'Sales inbox')).toBe(1);
    expect(times(words, 'Gmail')).toBe(1);
  });
});
