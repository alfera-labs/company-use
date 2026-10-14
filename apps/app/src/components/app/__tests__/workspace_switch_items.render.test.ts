// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceSwitcher } from '@/components/app/workspace_switcher';
import { query_keys } from '@/lib/api/query_keys';
import { team_viewer_role_query_key } from '@/lib/api/team_mode';

vi.mock('@tanstack/react-router', async (import_original) => ({
  ...(await import_original<typeof import('@tanstack/react-router')>()),
  Link: ({ to, children, ...anchor }: { to: string; children?: ReactNode }) =>
    createElement('a', { ...anchor, href: to }, children),
  useRouter: () => ({ invalidate: vi.fn() }),
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

function workspace(number: number) {
  return {
    workspace_id: `workspace_${number}`,
    organization_id: `organization_${number}`,
    workspace_name: `Workspace ${number}`,
    is_active: number === 1,
  };
}

async function items_of_the_open_menu(input: {
  workspace_count: number;
  can_make_workspaces: boolean;
  team_role?: string;
}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
  });
  client.setQueryData(
    query_keys.workspaces(),
    Array.from({ length: input.workspace_count }, (_, index) => workspace(index + 1)),
  );
  if (input.team_role) client.setQueryData(team_viewer_role_query_key, input.team_role);
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(WorkspaceSwitcher, {
          current_name: 'Workspace 1',
          can_make_workspaces: input.can_make_workspaces,
        }),
      ),
    ),
  );
  await act(async () =>
    document.querySelector<HTMLElement>('[aria-label="Workspace menu"]')?.click(),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  return [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent);
}

describe('the workspace menu', () => {
  it('offers no "Switch workspace" and no "New workspace" with one workspace that cannot make more', async () => {
    const items = await items_of_the_open_menu({ workspace_count: 1, can_make_workspaces: false });

    expect(items).toContain('Workspace settings');
    expect(items).not.toContain('Switch workspace');
    expect(items).not.toContain('New workspace');
  });

  it('offers "New workspace" itself, and no switch, with one workspace that can make more', async () => {
    const items = await items_of_the_open_menu({ workspace_count: 1, can_make_workspaces: true });

    expect(items).not.toContain('Switch workspace');
    expect(items.at(-1)).toBe('New workspace');
  });

  it('offers "Invite users" outside team mode and to an owner or an admin of a team', async () => {
    const no_team = await items_of_the_open_menu({ workspace_count: 1, can_make_workspaces: true });
    expect(no_team.at(0)).toBe('Invite users');
    act(() => root?.unmount());

    const admin = { workspace_count: 1, can_make_workspaces: false, team_role: 'admin' };
    expect(await items_of_the_open_menu(admin)).toContain('Invite users');
  });

  it('does not offer "Invite users" to a plain member of a team, and still lists Members', async () => {
    const member = { workspace_count: 1, can_make_workspaces: false, team_role: 'member' };
    const items = await items_of_the_open_menu(member);

    expect(items).not.toContain('Invite users');
    expect(items.at(0)).toBe('Workspace settings');
    expect(items).toContain('Members');
  });

  it('offers "Switch workspace" when there is another workspace', async () => {
    const items = await items_of_the_open_menu({ workspace_count: 2, can_make_workspaces: true });

    expect(items.at(-1)).toBe('Switch workspace');
  });
});
