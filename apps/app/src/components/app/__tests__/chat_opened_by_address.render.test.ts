// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chat_draft_key } from '@/components/app/chat_draft_storage';
import { useChatDraftStore } from '@/components/app/chat_draft_store';
import { chat_user_message_class_name } from '@/components/app/chat_message';
import { useChatOptimisticMessageStore } from '@/components/app/chat_optimistic_message_store';
import { ChatSessionView } from '@/components/app/chat_session_view';
import { list_sessions } from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';
import { AppAuthProvider } from '@/lib/auth_client';

vi.mock('@tanstack/react-router', async (import_original) => ({
  ...(await import_original<typeof import('@tanstack/react-router')>()),
  Link: ({ children }: { children?: ReactNode }) => createElement('a', null, children),
  useNavigate: () => () => undefined,
  useRouter: () => ({ preloadRoute: () => undefined }),
  useSearch: () => ({}),
}));

const session_id = 'ses_1';
const now = new Date().toISOString();
const welcome_text = 'Hey Dana! I am your new coworker.';

type Row = Record<string, unknown>;

const held_answers = { chat_list: [] as (() => void)[], history: [] as (() => void)[] };
const sent_bodies: Row[] = [];

function json(data: unknown, status = 200) {
  return Response.json({ data }, { status });
}

const session_row = {
  session_id,
  workspace_id: 'ws_1',
  agent_id: 'agent_1',
  project_id: null,
  session_title: 'Getting started',
  session_status: 'completed',
  session_source: 'dashboard',
  source_type: 'dashboard',
  source_metadata: {},
  session_metadata: {},
  created_time: now,
  last_updated_time: now,
};

const welcome_row = {
  run_message_id: 'msg_welcome',
  session_id,
  workspace_id: 'ws_1',
  run_id: 'run_1',
  message_role: 'assistant',
  message_kind: 'output',
  message_content: { type: 'text', text: welcome_text },
  message_sequence: 1,
  run_message_sequence: 1,
  is_user_visible: true,
  source_metadata: {},
  metadata: {},
  created_time: now,
};

function answer_when_released(held: (() => void)[], data: unknown) {
  return new Promise<Response>((resolve) => held.push(() => resolve(json(data))));
}

async function answer_api_request(input: RequestInfo | URL, init?: RequestInit) {
  if (input === '/auth/session')
    return Response.json({
      user: { id: 'user_1', email: 'dana@example.com', firstName: 'Dana', lastName: null },
      organizationId: null,
      impersonator: null,
    });
  const request = new Request(input, init);
  const path = new URL(request.url).pathname.replace(/^\/api/u, '');
  const chat = `/v1/sessions/${session_id}`;
  if (path === '/v1/sessions') return answer_when_released(held_answers.chat_list, [session_row]);
  if (path === `${chat}/messages`)
    return answer_when_released(held_answers.history, { items: [welcome_row], next_cursor: null });
  if (path === `${chat}/queued-messages` && request.method === 'GET') return json([]);
  if (path === `${chat}/queued-messages`) {
    sent_bodies.push((await request.json()) as Row);
    return json({ job_id: 'ejob_1', session_id, waiting_reason: 'starting' }, 202);
  }
  if (path === `${chat}/runs` || path === `${chat}/tool-calls`) return json([]);
  return new Promise<Response>(() => undefined);
}

let root: Root | null = null;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(answer_api_request));
  held_answers.chat_list = [];
  held_answers.history = [];
  sent_bodies.length = 0;
  useChatOptimisticMessageStore.setState({ optimistic_user_messages: [] });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function ChatPageOpenedByItsAddress() {
  const sessions_query = useQuery({ queryFn: list_sessions, queryKey: query_keys.sessions() });
  const open_session = sessions_query.data?.find((item) => item.session_id === session_id);
  return createElement(ChatSessionView, {
    onSessionReady: () => undefined,
    selectedSessionId: session_id,
    ...(open_session ? { selectedSession: open_session } : {}),
  });
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

async function mount_chat_page() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const page = createElement(AppAuthProvider, null, createElement(ChatPageOpenedByItsAddress));
  await act(async () => {
    root?.render(createElement(QueryClientProvider, { client }, page));
  });
  await settle();
}

async function the_api_answers(held: (() => void)[]) {
  for (const answer of held) answer();
  await settle();
}

function text_box() {
  const box = document.querySelector('textarea');
  if (!box) throw new Error('The composer has no text box');
  return box;
}

function type_and_press_send(text: string) {
  act(() => useChatDraftStore.getState().set_draft(chat_draft_key(session_id), text));
  act(() =>
    document.querySelector<HTMLButtonElement>('button[aria-label="Send message"]')?.click(),
  );
}

function chat_from_top_to_bottom() {
  const seen: string[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const element = node as HTMLElement;
    const own_text = element.childElementCount === 0 ? element.textContent?.trim() : '';
    if (element.className.startsWith(chat_user_message_class_name)) seen.push('my message');
    else if (own_text === welcome_text) seen.push('the welcome');
  }
  return seen;
}

function chat_title_in_the_header() {
  return document.querySelector('[aria-current="page"]')?.textContent;
}

describe('a chat opened by its address', () => {
  it('shows no title and takes no message until the chat is read, then shows both in place', async () => {
    await mount_chat_page();
    expect(chat_title_in_the_header()).toBe('');
    expect(text_box().disabled).toBe(true);

    type_and_press_send('Count the planets.');
    await settle();
    expect(sent_bodies).toEqual([]);
    expect(chat_from_top_to_bottom()).toEqual([]);

    await the_api_answers(held_answers.chat_list);
    expect(chat_title_in_the_header()).toBe('Getting started');
    expect(text_box().disabled).toBe(true);

    await the_api_answers(held_answers.history);
    expect(chat_from_top_to_bottom()).toEqual(['the welcome']);
    expect(text_box().disabled).toBe(false);
    expect(document.activeElement).toBe(text_box());

    act(() =>
      document.querySelector<HTMLButtonElement>('button[aria-label="Send message"]')?.click(),
    );
    await settle();
    expect(sent_bodies).toHaveLength(1);
    expect(chat_from_top_to_bottom()).toEqual(['the welcome', 'my message']);
  });
});
