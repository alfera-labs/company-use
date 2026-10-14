// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectAnythingSection } from '@/components/app/connect_anything_section';
import { McpServerAddressStep } from '@/components/app/mcp_server_address_step';
import { count_connected_accounts } from '@/components/connections/connected_accounts';
import { IntegrationDetail } from '@/components/connections/integration_detail';
import { team_viewer_role_query_key } from '@/lib/api/team_mode';
import type { Connection, IntegrationApp } from '@/lib/api/types';

vi.mock('@tanstack/react-router', async (import_original) => ({
  ...(await import_original<typeof import('@tanstack/react-router')>()),
  Link: ({ children }: { children?: ReactNode }) => createElement('a', null, children),
}));

let root: Root | null = null;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

async function rows_offered_when(saved_credentials_reach_the_sandbox: boolean, team_role?: string) {
  vi.stubGlobal('fetch', async () =>
    Response.json({
      data: { install: { app_provider_configured: true, saved_credentials_reach_the_sandbox } },
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (team_role) client.setQueryData(team_viewer_role_query_key, team_role);
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root?.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(ConnectAnythingSection, { onSelect: () => {} }),
      ),
    ),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  return [...container.querySelectorAll('.truncate')].map((row) => row.textContent);
}

function connection(connection_status: string) {
  return {
    connection_id: `con_${connection_status}`,
    connection_name: 'Granola',
    connection_status,
  } as Connection;
}

describe('the "Connect anything" rows', () => {
  it('offers no row that saves a credential the sandbox of this install never gets', async () => {
    expect(await rows_offered_when(false)).toEqual(['MCP server']);
  });

  it('offers every row where a saved credential reaches the sandbox', async () => {
    expect(await rows_offered_when(true)).toEqual(['MCP server', 'HTTP API', 'Website sign-in']);
  });
});

describe('the "MCP server" row on a team install', () => {
  const words_for_a_member = 'An owner or an admin adds servers for the team.';

  it('offers a plain member no button that ends in a refusal, and says who adds servers', async () => {
    await rows_offered_when(false, 'member');

    expect(document.querySelector('[aria-label="Connect MCP server"]')).toBeNull();
    expect(document.body.textContent).toContain(words_for_a_member);
    expect([...document.querySelectorAll('button')].map((button) => button.textContent)).toEqual(
      [],
    );
  });

  it.each(['owner', 'admin'])('offers the button to an %s', async (team_role) => {
    await rows_offered_when(false, team_role);

    expect(document.querySelector('[aria-label="Connect MCP server"]')).not.toBeNull();
    expect(document.body.textContent).not.toContain(words_for_a_member);
  });

  it('says the tools go to the coworker', () => {
    const html = renderToStaticMarkup(
      createElement(McpServerAddressStep, {
        draft: { server_url: '', display_name: '' } as never,
        pending: false,
        refusal: null,
        on_change: () => {},
        on_cancel: () => {},
        on_continue: () => {},
      }),
    );

    expect(html).toContain('its tools become available to your coworker.');
    expect(html).toContain('If the server needs an API key, you give it in the next step.');
  });

  it.each([
    'owner',
    'admin',
  ])('says to an %s what an MCP server is for, and that a key can be given', async (team_role) => {
    await rows_offered_when(false, team_role);

    expect(document.body.textContent).toContain(
      'Tools from any MCP server. You can give it an API key.',
    );
  });
});

describe('the connected accounts of an app', () => {
  it('never counts a setup that is pending, failed or expired', () => {
    const rows = ['pending_setup', 'failed', 'expired', 'active'].map(connection);

    expect(count_connected_accounts(rows)).toBe(1);
    expect(count_connected_accounts([connection('pending_setup')])).toBe(0);
  });

  it('says "0 accounts connected" for an app with one pending setup', () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(IntegrationDetail, {
          app: { app_id: 'app_1', app_display_name: 'Granola' } as IntegrationApp,
          connections: [connection('pending_setup')],
          description: '',
          iconUrl: undefined,
          onAddAccount: () => {},
          onBack: () => {},
        }),
      ),
    );

    expect(html).toContain('0 accounts connected');
    expect(html).not.toContain('1 account connected');
  });
});
