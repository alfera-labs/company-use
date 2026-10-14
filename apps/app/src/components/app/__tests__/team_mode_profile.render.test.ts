// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TeamModeProfile } from '@/components/app/team_mode_profile';
import { AppAuthProvider, useAuth } from '@/lib/auth_client';

vi.mock('@tanstack/react-router', async (import_original) => ({
  ...(await import_original<typeof import('@tanstack/react-router')>()),
  useRouter: () => ({ invalidate: async () => {} }),
}));

let root: Root | null = null;
let requests: { method: string; path: string }[];
let saved_name: string;

function NameInTheSidebar() {
  return createElement('output', null, useAuth().user?.firstName ?? '');
}

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  requests = [];
  saved_name = 'Dana';
  vi.stubGlobal('location', { ...window.location, assign: vi.fn() });
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(new URL(String(input), 'http://alfera.test'), init);
    const path = new URL(request.url).pathname.replace(/^.*(?=\/v1\/)/u, '');
    requests.push({ method: request.method, path });
    if (path === '/auth/session') {
      return Response.json({ user: { id: 'user_1', firstName: saved_name }, organizationId: 'o' });
    }
    if (request.method === 'PUT' && path === '/v1/team/my-name') {
      saved_name = ((await request.json()) as { name: string }).name;
      return Response.json({ data: {} });
    }
    if (path === '/v1/team/me') return Response.json({ data: { sign_ins: [], match_email: null } });
    const me = { user_id: 'user_1', first_name: saved_name, member_role: 'member' };
    return Response.json({ data: { viewer_user_id: 'user_1', members: [me] } });
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root?.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(
          AppAuthProvider,
          null,
          createElement(NameInTheSidebar),
          createElement(TeamModeProfile),
        ),
      ),
    ),
  );
  await settle();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

function button(text: string, within: ParentNode = document) {
  return [...within.querySelectorAll<HTMLElement>('button')].find(
    (one) => one.textContent === text,
  );
}

function sign_out_requests() {
  return requests.filter((request) => request.path === '/v1/team/sign-out-everywhere');
}

describe('"Sign out everywhere" in Settings → Profile', () => {
  it('asks first, and says what happens and how to come back', async () => {
    await act(async () => button('Sign out everywhere')?.click());
    await settle();

    const dialog = document.querySelector('[role="alertdialog"]');
    expect(sign_out_requests()).toEqual([]);
    expect(dialog?.textContent).toContain('Sign out everywhere?');
    expect(dialog?.textContent).toContain('This ends every session of yours, this one too.');
    expect(dialog?.textContent).toContain('you need a new sign-in link');
  });

  it('changes nothing on Cancel, and signs out on the second yes', async () => {
    await act(async () => button('Sign out everywhere')?.click());
    await settle();
    await act(async () => button('Cancel')?.click());
    await settle();
    expect(sign_out_requests()).toEqual([]);

    await act(async () => button('Sign out everywhere')?.click());
    await settle();
    const dialog = document.querySelector<HTMLElement>('[role="alertdialog"]');
    await act(async () => button('Sign out everywhere', dialog ?? document)?.click());
    await settle();

    expect(sign_out_requests()).toHaveLength(1);
  });
});

describe('the name field in Settings → Profile', () => {
  it('has a label a person can see', () => {
    const label = [...document.querySelectorAll('label')].find(
      (one) => one.textContent === 'Your name',
    );
    const field = document.getElementById(label?.htmlFor ?? 'no label');

    expect(field?.tagName).toBe('INPUT');
    expect(label?.className ?? 'sr-only').not.toContain('sr-only');
  });

  it('shows the new name in the sidebar at once', async () => {
    const field = document.querySelector<HTMLInputElement>('input[maxlength="120"]');
    const set_value = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
      set_value?.call(field, 'Dana Reyes');
      field?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(document.querySelector('output')?.textContent).toBe('Dana');

    await act(async () => field?.form?.requestSubmit());
    await settle();

    expect(document.querySelector('output')?.textContent).toBe('Dana Reyes');
  });
});
