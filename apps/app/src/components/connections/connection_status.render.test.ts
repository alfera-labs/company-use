import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ConnectionRow } from '@/components/app/integrations_page';
import { ConnectionDetailPage } from '@/components/connections/connection_detail_page';
import {
  read_connection_status_label,
  words_for_tools_read_again,
} from '@/components/connections/connection_status';
import { query_keys } from '@/lib/api/query_keys';
import type { Connection } from '@/lib/api/types';

vi.mock('@tanstack/react-router', async (import_original) => ({
  ...(await import_original<typeof import('@tanstack/react-router')>()),
  Link: ({ to, children, ...anchor }: { to?: string; children?: ReactNode }) =>
    createElement('a', { ...anchor, href: to }, children),
  useNavigate: () => vi.fn(),
}));

const switched_off = {
  status_label: 'Switched off',
  sentence:
    'Servers on your own machine or network are switched off on this install. To switch them on again, run ./alfera add local-mcp on the machine that runs Alfera.',
};

function an_mcp_connection(fields: Record<string, unknown>) {
  return {
    connection_id: 'conn_kettle',
    connection_name: 'Kettle notes',
    connection_status: 'active',
    provider_key: 'mcp',
    external_account_name: null,
    external_account_id: null,
    connected_time: '2026-10-12T09:00:00.000Z',
    created_time: '2026-10-12T09:00:00.000Z',
    permissions: { can_use: true, can_manage: false, can_delete: false },
    app: null,
    ...fields,
  } as Connection;
}

function words_of(element: ReturnType<typeof createElement>, client = new QueryClient()) {
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, element));
  return html.replace(/<[^>]*>/gu, '\n');
}

function words_in_the_list_of(connection: Connection) {
  return words_of(
    createElement(ConnectionRow, {
      connection,
      connections: [connection],
      isReconnectPending: false,
      isRevokePending: false,
      onManage: () => undefined,
      onOpen: () => undefined,
      onReconnect: () => undefined,
      onRevoke: () => undefined,
      organizationLine: createElement('span'),
      siblingAudienceNote: null,
    }),
  );
}

function words_on_the_page_of(connection: Connection) {
  const client = new QueryClient();
  client.setQueryData(query_keys.connection(connection.connection_id), connection);
  return words_of(
    createElement(ConnectionDetailPage, { connection_id: connection.connection_id }),
    client,
  );
}

const times = (words: string, word: string) => words.split(word).length - 1;

describe('the state of a connection in the list of connections', () => {
  it('reads Active under the name of a connection that works, and no more', () => {
    const words = words_in_the_list_of(an_mcp_connection({}));

    expect(words).toContain('Active · ');
    expect(words).not.toContain('Switched off');
  });

  it('reads Switched off under the name, then the sentence with the command', () => {
    const words = words_in_the_list_of(an_mcp_connection({ cannot_work_now: switched_off }));

    expect(words).toContain('Switched off · ');
    expect(words).not.toContain('Active');
    expect(words.indexOf('Switched off · ')).toBeLessThan(words.indexOf(switched_off.sentence));
  });

  it('says what stops a connection before the account it is connected to', () => {
    const words = words_in_the_list_of(
      an_mcp_connection({
        external_account_name: 'notes@example.com',
        cannot_work_now: { status_label: 'Not working', sentence: 'The server did not answer.' },
      }),
    );

    expect(words).toContain('Not working · ');
    expect(words).toContain('The server did not answer.');
  });
});

describe('the state of a connection on its page', () => {
  it('reads Active next to the title and in the details of a connection that works', () => {
    const words = words_on_the_page_of(an_mcp_connection({}));

    expect(times(words, 'Active')).toBe(2);
  });

  it('reads Switched off in both places, and the sentence once, under the title', () => {
    const words = words_on_the_page_of(an_mcp_connection({ cannot_work_now: switched_off }));

    expect(times(words, 'Switched off')).toBe(2);
    expect(times(words, switched_off.sentence)).toBe(1);
    expect(words).not.toContain('Active');
    expect(words.indexOf(switched_off.sentence)).toBeLessThan(words.indexOf('Connection details'));
  });

  it('keeps the other states as they were', () => {
    expect(read_connection_status_label({ connection_status: 'pending_setup' })).toBe(
      'Pending Setup',
    );
    expect(read_connection_status_label({ connection_status: 'built_in' })).toBe('Built In');
  });
});

describe('what a person reads after Reconnect on a server with no sign-in', () => {
  it('names the server and counts its tools', () => {
    expect(words_for_tools_read_again('Kettle notes', 1)).toBe(
      'Kettle notes answers, and Alfera read its tools again: 1 tool.',
    );
    expect(words_for_tools_read_again('Kettle notes', 3)).toBe(
      'Kettle notes answers, and Alfera read its tools again: 3 tools.',
    );
  });
});
