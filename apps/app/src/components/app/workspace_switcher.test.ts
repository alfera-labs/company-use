import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { update_workspace_name_in_list } from '@/components/app/workspace_settings';
import { has_multiple_workspaces, WorkspaceSwitcher } from '@/components/app/workspace_switcher';
import { query_keys } from '@/lib/api/query_keys';

vi.mock('@tanstack/react-router', async (import_original) => ({
  ...(await import_original<typeof import('@tanstack/react-router')>()),
  Link: ({ to, params, preload, href, children, ...anchor }: StubLinkProps) =>
    createElement('a', { ...anchor, href: href ?? stub_link_href(to ?? '', params) }, children),
  useRouter: () => ({ invalidate: vi.fn() }),
}));

function render_workspace_switcher(
  workspaces: readonly unknown[],
  single_workspace_view: 'name' | 'hidden' = 'name',
) {
  const query_client = new QueryClient();
  query_client.setQueryData(query_keys.workspaces(), workspaces);
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: query_client },
      createElement(WorkspaceSwitcher, { current_name: 'Alfera', single_workspace_view }),
    ),
  );
}

describe('has_multiple_workspaces', () => {
  it.each([
    { count: 0, visible: false },
    { count: 1, visible: false },
    { count: 2, visible: true },
    { count: 3, visible: true },
  ])('returns $visible for $count workspaces', ({ count, visible }) => {
    expect(has_multiple_workspaces(Array.from({ length: count }))).toBe(visible);
  });
});

describe('WorkspaceSwitcher', () => {
  it.each([0, 1])('renders the workspace menu trigger for %i workspaces', (count) => {
    const html = render_workspace_switcher(
      count
        ? [
            {
              workspace_id: 'workspace_1',
              organization_id: 'organization_1',
              workspace_name: 'Alfera',
              is_active: true,
            },
          ]
        : [],
    );

    expect(html).toContain('aria-label="Workspace menu"');
    expect(html).toContain('Alfera');
  });

  it('hides the onboarding switcher for one workspace', () => {
    expect(
      render_workspace_switcher(
        [
          {
            workspace_id: 'workspace_1',
            organization_id: 'organization_1',
            workspace_name: 'Alfera',
            is_active: true,
          },
        ],
        'hidden',
      ),
    ).toBe('');
  });
});

describe('update_workspace_name_in_list', () => {
  it('updates the matching workspace without changing the others', () => {
    const workspaces = [
      { workspace_id: 'ws_active', workspace_name: 'Old name', is_active: true },
      { workspace_id: 'ws_other', workspace_name: 'Other', is_active: false },
    ];

    expect(
      update_workspace_name_in_list(workspaces, {
        workspace_id: 'ws_active',
        workspace_name: 'New name',
      }),
    ).toEqual([
      { workspace_id: 'ws_active', workspace_name: 'New name', is_active: true },
      { workspace_id: 'ws_other', workspace_name: 'Other', is_active: false },
    ]);
  });

  it('keeps an unfetched workspace list unfetched', () => {
    expect(
      update_workspace_name_in_list(undefined, {
        workspace_id: 'ws_active',
        workspace_name: 'New name',
      }),
    ).toBeUndefined();
  });
});

type StubLinkProps = {
  to?: string;
  href?: string;
  params?: Record<string, string> | undefined;
  preload?: unknown;
  children?: ReactNode;
  [key: string]: unknown;
};

function stub_link_href(to: string, params: Record<string, string> | undefined) {
  return to
    .replace(/\{-\$(\w+)\}/gu, (_segment, key: string) => params?.[key] ?? '')
    .replace(/\$(\w+)/gu, (_segment, key: string) => params?.[key] ?? '')
    .replace(/\/$/u, '');
}
