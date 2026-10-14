import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SidebarChatLink } from '@/components/app/sidebar_chat_link';
import type { Session } from '@/lib/api';

vi.mock('@tanstack/react-router', async (import_original) => ({
  ...(await import_original<typeof import('@tanstack/react-router')>()),
  Link: ({ to, params, preload, href, children, ...anchor }: StubLinkProps) =>
    createElement('a', { ...anchor, href: href ?? stub_link_href(to ?? '', params) }, children),
  useLocation: ({ select }: { select: (location: { pathname: string }) => unknown }) =>
    select({ pathname: '/chats' }),
  useNavigate: () => vi.fn(),
}));
afterEach(() => vi.restoreAllMocks());

function render_link(props: Parameters<typeof SidebarChatLink>[0]) {
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(SidebarChatLink, props),
    ),
  );
}

describe('SidebarChatLink', () => {
  it('keeps the Slack source visible beside the running state', () => {
    const html = render_link({
      isActive: true,
      project_label: 'Alfera',
      session: chat_session({ session_source: 'slack', session_status: 'running' }),
    });

    expect(html).toContain('aria-label="Slack"');
    expect(html).toContain('aria-label="Chat is running"');
    expect(html).toContain('aria-current="page"');
  });

  it('offers a delete button on an idle chat, but never on a running one', () => {
    const idle = render_link({
      isActive: false,
      session: chat_session({ session_source: 'dashboard', session_status: 'active' }),
    });
    const running = render_link({
      isActive: false,
      session: chat_session({ session_source: 'dashboard', session_status: 'running' }),
    });

    expect(idle).toContain('aria-label="Delete chat');
    expect(running).not.toContain('aria-label="Delete chat');
  });

  it('offers rename and move on every chat, idle or running', () => {
    const idle = render_link({
      isActive: false,
      session: chat_session({ session_source: 'dashboard', session_status: 'active' }),
    });
    const running = render_link({
      isActive: false,
      session: chat_session({ session_source: 'dashboard', session_status: 'running' }),
    });

    expect(idle).toContain('aria-label="Rename or move chat Workflow discovery"');
    expect(running).toContain('aria-label="Rename or move chat Workflow discovery"');
  });

  it('uses the web channel mark for dashboard sessions', () => {
    const dashboard = render_link({
      isActive: false,
      session: chat_session({ session_source: 'dashboard', session_status: 'active' }),
    });
    const web = render_link({
      isActive: false,
      session: chat_session({ session_source: 'web', session_status: 'active' }),
    });

    expect(dashboard).toContain('lucide-message-circle');
    expect(dashboard).toContain('stroke-width="1.5"');
    expect(web).toContain('lucide-message-circle');
    expect(web).toContain('stroke-width="1.5"');
    expect(dashboard).not.toContain('aria-label="Slack"');
    expect(dashboard).not.toContain('aria-label="Chat is running"');
  });

  it('removes the generic bubble from context rows while keeping email and unread marks', () => {
    const dashboard = render_link({
      isActive: false,
      project_label: 'Personal',
      session: chat_session({ session_source: 'dashboard', session_status: 'active' }),
    });
    const email = render_link({
      isActive: false,
      isUnread: true,
      project_label: 'Sales',
      session: chat_session({ session_source: 'email', session_status: 'active' }),
    });
    expect(dashboard).not.toContain('lucide-message-square');
    expect(dashboard).toContain('Personal');
    expect(email).toContain('lucide-mail');
    expect(email).toContain('aria-label="Unread messages"');
    expect(email).toContain('aria-label="Delete chat');
  });
});

function chat_session(input: Pick<Session, 'session_source' | 'session_status'>): Session {
  return {
    session_id: 'ses_1',
    session_title: 'Workflow discovery',
    created_time: '2026-07-10T09:00:00.000Z',
    last_updated_time: '2026-07-10T10:00:00.000Z',
    last_message_time: '2026-07-10T09:59:00.000Z',
    ...input,
  } as Session;
}

describe('sidebar run information', () => {
  it('shows the recorded finish age instead of the latest message age', () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-07-10T10:00:00Z'));
    const props: Parameters<typeof SidebarChatLink>[0] = {
      isActive: false,
      project_label: 'Sales',
      session: {
        ...chat_session({ session_source: 'email', session_status: 'active' }),
        latest_run: {
          run_id: 'run_1',
          run_status: 'completed',
          created_time: '2026-07-10T09:00:00Z',
          finished_time: '2026-07-10T09:58:00Z',
        },
      },
    };
    const finished_label = /Finished Jul 10, 2026(?:,| at) 09:58:00 UTC/;
    const html = render_link({ ...props, now: Date.parse('2026-07-10T10:00:00Z') });
    expect(html).toContain('>2m<');
    expect(html).toMatch(finished_label);
    expect(html).not.toContain('Updated Jul');
    const later_html = render_link({ ...props, now: Date.parse('2026-07-10T10:01:00Z') });
    expect(later_html).toContain('>3m<');
    expect(later_html).toMatch(finished_label);
  });

  it.each([
    ['queued', 'Queued'],
    ['starting', 'Starting'],
    ['running', 'Working'],
    ['waiting', 'Waiting'],
    ['failed', 'Failed'],
    ['cancelled', 'Stopped'],
    ['expired', 'Expired'],
  ])('shows %s without a completion claim', (run_status, label) => {
    const html = render_link({
      isActive: false,
      project_label: 'Sales',
      session: {
        ...chat_session({ session_source: 'dashboard', session_status: 'active' }),
        latest_run: {
          run_id: 'run_1',
          run_status,
          created_time: '2026-07-10T09:00:00Z',
          finished_time: null,
        },
      },
    });
    expect(html).toContain(`>${label}<`);
    expect(html).not.toContain('Finished');
    if (['queued', 'starting', 'running', 'waiting'].includes(run_status))
      expect(html).not.toContain('aria-label="Delete chat');
  });

  it('shows current work over an older completed run', () => {
    const html = render_link({
      isActive: false,
      project_label: 'Sales',
      session: {
        ...chat_session({ session_source: 'dashboard', session_status: 'running' }),
        latest_run: {
          run_id: 'run_1',
          run_status: 'completed',
          created_time: '2026-07-10T09:00:00Z',
          finished_time: '2026-07-10T09:58:00Z',
        },
      },
    });
    expect(html).toContain('>Working<');
    expect(html).not.toContain('Finished');
  });

  it('distinguishes an unrun chat update from a new chat', () => {
    const session = chat_session({ session_source: 'dashboard', session_status: 'active' });
    const updated = render_link({ isActive: false, project_label: 'Personal', session });
    const created = render_link({
      isActive: false,
      project_label: 'Personal',
      session: { ...session, last_message_time: null },
    });
    expect(updated).toContain('Updated Jul');
    expect(created).toContain('Created Jul');
    expect(updated + created).not.toContain('Finished');
  });

  it('keeps the project in the description when the row shows one line', () => {
    const html = render_link({
      isActive: false,
      project_label: 'Sales',
      session: chat_session({ session_source: 'email', session_status: 'active' }),
    });
    const visible_text = (
      html.match(/href="\/chats\/ses_1"[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? ''
    ).replace(/<[^>]*>/g, '');
    expect(visible_text).toContain('Workflow discovery');
    expect(html).toContain('Email · Sales · Read');
    expect(html).toContain('hidden max-w-full');
  });

  it('renders a shared project but not a personal project in the hover row', () => {
    const shared = render_link({
      isActive: false,
      project_label: 'Personal',
      project_is_personal: false,
      session: chat_session({ session_source: 'dashboard', session_status: 'active' }),
    });
    const personal = render_link({
      isActive: false,
      project_label: 'Personal',
      project_is_personal: true,
      session: chat_session({ session_source: 'dashboard', session_status: 'active' }),
    });

    const shared_text = (
      shared.match(/href="\/chats\/ses_1"[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? ''
    ).replace(/<[^>]*>/g, '');
    const personal_text = (
      personal.match(/href="\/chats\/ses_1"[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? ''
    ).replace(/<[^>]*>/g, '');

    expect(shared_text).toContain('Personal');
    expect(personal_text).not.toContain('Personal');
    expect(shared).toContain('Web · Personal · Read');
    expect(personal).toContain('Web · Personal · Read');
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
