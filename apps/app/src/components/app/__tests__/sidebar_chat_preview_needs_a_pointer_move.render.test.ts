// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SidebarChatLink } from '@/components/app/sidebar_chat_link';
import type { Session } from '@/lib/api/types';

vi.mock('@tanstack/react-router', async (import_original) => ({
  ...(await import_original<typeof import('@tanstack/react-router')>()),
  Link: ({ href, children, ...anchor }: { href?: string; children?: ReactNode }) =>
    createElement('a', { ...anchor, href }, children),
  useLocation: ({ select }: { select: (location: { pathname: string }) => unknown }) =>
    select({ pathname: '/chats' }),
  useNavigate: () => vi.fn(),
}));

const chat = {
  session_id: 'ses_1',
  session_title: 'Weekly numbers',
  session_source: 'dashboard',
  session_status: 'completed',
  project_id: null,
  created_time: '2026-07-10T09:00:00.000Z',
  last_updated_time: '2026-07-10T10:00:00.000Z',
  last_message_time: '2026-07-10T09:59:00.000Z',
} as Session;

const time_before_the_card_opens_ms = 700;
let root: Root | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', async () => Response.json({ data: { items: [], next_cursor: null } }));
  Object.assign(Element.prototype, { getAnimations: () => [] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const row = createElement(SidebarChatLink, { isActive: false, session: chat });
  act(() => root?.render(createElement(QueryClientProvider, { client }, row)));
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function row_link() {
  const link = document.querySelector<HTMLElement>('a[href="/chats/ses_1"]');
  if (!link) throw new Error('The chat row is not on the page.');
  return link;
}

function card() {
  return document.querySelector<HTMLElement>('[data-slot="preview-card-content"]');
}

function send(type: string, bubbles: boolean, related_target: Element | null = null) {
  const pointer_event = type.startsWith('pointer');
  const init = { bubbles, clientX: 40, clientY: 12, relatedTarget: related_target };
  act(() => {
    row_link().dispatchEvent(
      pointer_event
        ? new PointerEvent(type, { ...init, pointerType: 'mouse' })
        : new MouseEvent(type, init),
    );
  });
}

function the_row_comes_under_the_pointer_with_no_move() {
  send('pointerover', true, document.body);
  send('mouseover', true, document.body);
  send('mouseenter', false, document.body);
}

function the_pointer_moves_on_the_row() {
  send('pointermove', true);
  send('mousemove', true);
}

function the_pointer_leaves_the_row() {
  send('pointerout', true, document.body);
  send('mouseout', true, document.body);
  send('mouseleave', false, document.body);
}

async function wait(milliseconds: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

describe('the preview card of a chat row in the sidebar', () => {
  it('opens when the pointer moves onto the row and rests there, as before', async () => {
    the_row_comes_under_the_pointer_with_no_move();
    the_pointer_moves_on_the_row();

    await wait(time_before_the_card_opens_ms - 1);
    expect(card()).toBeNull();

    await wait(1);
    expect(card()?.textContent).toContain('Weekly numbers');
  });

  it('stays shut when the row slides under a pointer that does not move', async () => {
    the_row_comes_under_the_pointer_with_no_move();

    await wait(time_before_the_card_opens_ms * 3);

    expect(card()).toBeNull();
  });

  it('opens once the resting pointer moves on the row that slid under it', async () => {
    the_row_comes_under_the_pointer_with_no_move();
    await wait(time_before_the_card_opens_ms * 3);
    expect(card()).toBeNull();

    the_pointer_moves_on_the_row();
    await wait(time_before_the_card_opens_ms - 1);
    expect(card()).toBeNull();

    await wait(1);
    expect(card()?.textContent).toContain('Weekly numbers');
  });

  it('stays shut when the row slides back under the pointer after a real visit', async () => {
    the_row_comes_under_the_pointer_with_no_move();
    the_pointer_moves_on_the_row();
    the_pointer_leaves_the_row();
    await wait(time_before_the_card_opens_ms * 3);
    expect(card()).toBeNull();

    the_row_comes_under_the_pointer_with_no_move();
    await wait(time_before_the_card_opens_ms * 3);

    expect(card()).toBeNull();
  });

  it('opens nothing when the pointer moved on the row and left before the card was due', async () => {
    the_row_comes_under_the_pointer_with_no_move();
    await wait(time_before_the_card_opens_ms * 3);
    the_pointer_moves_on_the_row();
    await wait(time_before_the_card_opens_ms - 1);
    the_pointer_leaves_the_row();

    await wait(time_before_the_card_opens_ms * 3);

    expect(card()).toBeNull();
  });
});
