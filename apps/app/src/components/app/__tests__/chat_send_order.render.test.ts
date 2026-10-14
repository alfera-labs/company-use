// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, createElement, type ReactNode, useState } from 'react';
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
import { page_title } from '@/lib/page_title';

vi.mock('@tanstack/react-router', async (import_original) => ({
  ...(await import_original<typeof import('@tanstack/react-router')>()),
  Link: ({ children }: { children?: ReactNode }) => createElement('a', null, children),
  useNavigate: () => () => undefined,
  useRouter: () => ({ preloadRoute: () => undefined }),
  useSearch: () => ({}),
}));

const typed_text = 'Count the planets.';
const welcome_text = 'Hey Dana! I am your new coworker and I build small tools for you.';
const session_id = 'ses_1';
const now = new Date().toISOString();

type Row = Record<string, unknown>;

const signed_in_person = {
  user: { id: 'user_1', email: 'dana@example.com', firstName: 'Dana', lastName: null },
  organizationId: null,
  impersonator: null,
};

const rows_the_api_answers_with = {
  sessions: [] as Row[],
  queued: [] as Row[],
  runs: [] as Row[],
  messages: [] as Row[],
  sent_bodies: [] as Row[],
  repeat_bodies: [] as Row[],
};

function session_row(title: string): Row {
  return {
    session_id,
    workspace_id: 'ws_1',
    agent_id: 'agent_1',
    project_id: null,
    session_title: title,
    session_status: 'running',
    session_source: 'dashboard',
    source_type: 'dashboard',
    source_metadata: {},
    session_metadata: {},
    created_time: now,
    last_updated_time: now,
  };
}

function run_row(run_status: string): Row {
  return { run_id: 'run_1', session_id, workspace_id: 'ws_1', run_status, created_time: now };
}

function message_row(input: {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  sequence: number;
  source_metadata?: Row;
}): Row {
  return {
    run_message_id: input.id,
    session_id,
    workspace_id: 'ws_1',
    run_id: 'run_1',
    message_role: input.role,
    message_kind: input.role === 'user' ? 'input' : 'output',
    message_content: { type: 'text', text: input.text },
    message_sequence: input.sequence,
    run_message_sequence: input.sequence,
    is_user_visible: true,
    is_model_visible: true,
    source_type: 'dashboard',
    source_metadata: input.source_metadata ?? {},
    metadata: {},
    created_time: now,
    last_updated_time: now,
  };
}

function json(data: unknown, status = 200) {
  return Response.json({ data }, { status });
}

async function answer_api_request(input: RequestInfo | URL, init?: RequestInit) {
  if (input === '/auth/session') return Response.json(signed_in_person);
  const request = new Request(input, init);
  const path = new URL(request.url).pathname.replace(/^\/api/u, '');
  const is_read = request.method === 'GET';
  if (path === '/v1/sessions' && is_read) return json(rows_the_api_answers_with.sessions);
  if (path === '/v1/sessions') {
    rows_the_api_answers_with.sessions = [session_row('Untitled session')];
    return json(rows_the_api_answers_with.sessions[0], 201);
  }
  if (path === `/v1/sessions/${session_id}/queued-messages` && is_read)
    return json(rows_the_api_answers_with.queued);
  if (path === `/v1/sessions/${session_id}/queued-messages/repeat`) {
    const body = (await request.json()) as Row;
    rows_the_api_answers_with.repeat_bodies.push(body);
    rows_the_api_answers_with.queued = [
      {
        ...queued_row(String(body.client_message_id)),
        repeats_run_message_id: body.run_message_id,
      },
    ];
    return json({ job_id: 'ejob_2', session_id, waiting_reason: 'starting' }, 202);
  }
  if (path === `/v1/sessions/${session_id}/queued-messages`) {
    const body = (await request.json()) as Row;
    rows_the_api_answers_with.sent_bodies.push(body);
    rows_the_api_answers_with.queued = [queued_row(String(body.client_message_id))];
    return json({ job_id: 'ejob_1', session_id, waiting_reason: 'starting' }, 202);
  }
  if (path === `/v1/sessions/${session_id}/runs`) return json(rows_the_api_answers_with.runs);
  if (path === `/v1/sessions/${session_id}/messages`) {
    return json({ items: rows_the_api_answers_with.messages, next_cursor: null });
  }
  if (path === `/v1/sessions/${session_id}/tool-calls`) return json([]);
  return new Promise<Response>(() => undefined);
}

function queued_row(client_message_id: string): Row {
  return {
    job_id: 'ejob_1',
    client_message_id,
    preview_text: typed_text,
    attachment_count: 0,
    created_time: now,
    state: 'queued',
    waiting_reason: 'starting',
  };
}

let root: Root | null = null;
let client: QueryClient;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(answer_api_request));
  Object.assign(rows_the_api_answers_with, { sessions: [], queued: [], runs: [], messages: [] });
  Object.assign(rows_the_api_answers_with, { sent_bodies: [], repeat_bodies: [] });
  useChatOptimisticMessageStore.setState({ optimistic_user_messages: [] });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function ChatPageWithoutTheRouter({ first_open_session_id }: { first_open_session_id?: string }) {
  const [open_session_id, set_open_session_id] = useState(first_open_session_id);
  const sessions_query = useQuery({ queryFn: list_sessions, queryKey: query_keys.sessions() });
  const open_session = sessions_query.data?.find((item) => item.session_id === open_session_id);
  return createElement(ChatSessionView, {
    onSessionReady: set_open_session_id,
    ...(open_session_id ? { selectedSessionId: open_session_id } : {}),
    ...(open_session ? { selectedSession: open_session } : {}),
  });
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

async function mount_chat_page(first_open_session_id?: string) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const page = createElement(
    ChatPageWithoutTheRouter,
    first_open_session_id ? { first_open_session_id } : {},
  );
  const signed_in_page = createElement(AppAuthProvider, null, page);
  await act(async () => {
    root?.render(createElement(QueryClientProvider, { client }, signed_in_page));
  });
  await settle();
}

async function read_the_api_again() {
  const reads_that_may_never_finish = () => void client.invalidateQueries();
  act(reads_that_may_never_finish);
  await settle();
}

async function type_and_send(open_session_id?: string) {
  act(() => useChatDraftStore.getState().set_draft(chat_draft_key(open_session_id), typed_text));
  const send = document.querySelector<HTMLButtonElement>('button[aria-label="Send message"]');
  if (!send) throw new Error('The send button did not render');
  act(() => send.click());
}

function chat_from_top_to_bottom() {
  const seen: string[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const element = node as HTMLElement;
    const own_text = element.childElementCount === 0 ? element.textContent?.trim() : '';
    if (element.className.startsWith(chat_user_message_class_name)) seen.push('my message');
    else if (element.getAttribute('role') === 'status' && element.textContent?.includes('Working'))
      seen.push('Working');
    else if (own_text === 'Today') seen.push('Today');
    else if (own_text === 'Dana') seen.push('my name');
    else if (own_text === 'Eight planets.') seen.push('the answer');
    else if (own_text === 'Eight, again.') seen.push('the new answer');
    else if (own_text === welcome_text) seen.push('the welcome');
    else if (own_text === 'Queued') seen.push('Queued');
  }
  return seen;
}

function chat_title_in_the_header() {
  return document.querySelector('[aria-current="page"]')?.textContent;
}

const sent_and_working = ['Today', 'my name', 'my message', 'Working'];

function the_run_starts() {
  rows_the_api_answers_with.queued = [];
  rows_the_api_answers_with.runs = [run_row('running')];
}

describe('sending a message in a new chat', () => {
  it('keeps the message, its day and its sender above "Working" at every step', async () => {
    await mount_chat_page();

    await type_and_send();
    expect(chat_from_top_to_bottom()).toEqual(sent_and_working);

    await settle();
    await read_the_api_again();
    expect(rows_the_api_answers_with.sent_bodies).toHaveLength(1);
    expect(rows_the_api_answers_with.queued).toHaveLength(1);
    expect(chat_from_top_to_bottom()).toEqual(sent_and_working);
    expect(chat_title_in_the_header()).toBe('New chat');

    the_run_starts();
    rows_the_api_answers_with.messages = [
      message_row({
        id: 'msg_1',
        role: 'user',
        text: typed_text,
        sequence: 1,
        source_metadata: {
          client_message_id: rows_the_api_answers_with.sent_bodies[0]?.client_message_id,
          source_actor: { source_actor_id: 'actor_1', profile: { display_name: 'Dana' } },
        },
      }),
    ];
    await read_the_api_again();
    expect(chat_from_top_to_bottom()).toEqual(sent_and_working);

    rows_the_api_answers_with.runs = [run_row('completed')];
    rows_the_api_answers_with.messages = [
      ...rows_the_api_answers_with.messages,
      message_row({ id: 'msg_2', role: 'assistant', text: 'Eight planets.', sequence: 2 }),
    ];
    rows_the_api_answers_with.sessions = [
      { ...session_row('Planet count'), session_status: 'completed' },
    ];
    await read_the_api_again();
    await vi.waitFor(async () => {
      await settle();
      expect(chat_from_top_to_bottom()).toEqual(['Today', 'my name', 'my message', 'the answer']);
    }, 8000);
    expect(chat_title_in_the_header()).toBe('Planet count');
    expect(document.title).toBe(page_title('Planet count'));
  });
});

describe('sending in the first chat while the welcome still types', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    rows_the_api_answers_with.sessions = [
      {
        ...session_row('Getting started'),
        session_status: 'completed',
        source_metadata: { onboarding_scan: { findings: [] } },
      },
    ];
    rows_the_api_answers_with.messages = [
      message_row({ id: 'msg_welcome', role: 'assistant', text: welcome_text, sequence: 1 }),
    ];
  });

  const welcome_then_message = ['Today', 'the welcome', 'my name', 'my message', 'Working'];
  const wait_ms = (ms: number) =>
    act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  it('shows the whole welcome from the send on, and never types it again', async () => {
    await mount_chat_page(session_id);
    await wait_ms(900);
    expect(chat_from_top_to_bottom()).not.toContain('the welcome');

    await type_and_send(session_id);
    expect(chat_from_top_to_bottom()).toEqual(sent_and_working);
    expect(document.body.textContent).toContain('Hey Dana!');
    await vi.waitFor(async () => {
      await settle();
      expect(chat_from_top_to_bottom()).toEqual(welcome_then_message);
    }, 3000);

    await read_the_api_again();
    expect(rows_the_api_answers_with.queued).toHaveLength(1);
    expect(chat_from_top_to_bottom()).toEqual(welcome_then_message);

    rows_the_api_answers_with.queued = [
      {
        ...queued_row(String(rows_the_api_answers_with.sent_bodies[0]?.client_message_id)),
        state: 'not_sent',
        reason_code: 'could_not_be_read',
        reason: 'The message could not be read',
        retry_message: null,
      },
    ];
    await read_the_api_again();
    expect(chat_from_top_to_bottom()).toContain('the welcome');
    expect(document.body.textContent).toContain('Not sent');
  });
});

describe('a message that another tab sent', () => {
  beforeEach(() => {
    rows_the_api_answers_with.sessions = [session_row('Planet count')];
    rows_the_api_answers_with.runs = [];
    rows_the_api_answers_with.messages = [];
  });

  it('is above "Working" while its run starts', async () => {
    rows_the_api_answers_with.queued = [queued_row('client:other_tab')];
    await mount_chat_page(session_id);

    expect(chat_from_top_to_bottom()).toEqual(['my message', 'Working']);
  });

  it('is below "Working", marked "Queued", while the chat is busy with an earlier run', async () => {
    rows_the_api_answers_with.runs = [run_row('running')];
    rows_the_api_answers_with.queued = [
      { ...queued_row('client:other_tab'), waiting_reason: 'session_busy' },
    ];
    await mount_chat_page(session_id);

    expect(chat_from_top_to_bottom()).toEqual(['Working', 'my message', 'Queued']);
  });
});

describe('sending while scrolled up in a long chat', () => {
  beforeEach(() => {
    rows_the_api_answers_with.sessions = [
      { ...session_row('Planet count'), session_status: 'completed' },
    ];
    rows_the_api_answers_with.messages = [
      message_row({ id: 'msg_old', role: 'assistant', text: 'Eight planets.', sequence: 1 }),
    ];
  });

  it('brings the reader down to their own message', async () => {
    await mount_chat_page(session_id);
    const scroller = document.querySelector<HTMLElement>('[role="log"] > div');
    if (!scroller) throw new Error('The chat scroller did not render');
    Object.defineProperty(scroller, 'scrollHeight', { value: 3000 });
    Object.defineProperty(scroller, 'clientHeight', { value: 700 });
    act(() => {
      scroller.scrollTop = 0;
      scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: -400, bubbles: true }));
    });

    await type_and_send(session_id);

    await vi.waitFor(async () => {
      await settle();
      expect(scroller.scrollTop).toBeGreaterThan(2200);
    }, 5000);
  });
});

describe('Regenerate response', () => {
  const question = message_row({ id: 'msg_1', role: 'user', text: typed_text, sequence: 1 });
  const answer = message_row({
    id: 'msg_2',
    role: 'assistant',
    text: 'Eight planets.',
    sequence: 2,
  });

  beforeEach(() => {
    rows_the_api_answers_with.sessions = [
      { ...session_row('Planet count'), session_status: 'completed' },
    ];
    rows_the_api_answers_with.runs = [run_row('cancelled')];
    rows_the_api_answers_with.messages = [question, answer];
  });

  it('runs the stored message again and never shows the message a second time', async () => {
    await mount_chat_page(session_id);
    expect(chat_from_top_to_bottom()).toEqual(['Today', 'my message', 'the answer']);
    const regenerate = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Regenerate response"]',
    );
    if (!regenerate) throw new Error('The regenerate button did not render');

    act(() => regenerate.click());
    await settle();
    expect(rows_the_api_answers_with.repeat_bodies).toEqual([
      { run_message_id: 'msg_1', client_message_id: expect.stringMatching(/^client:/u) },
    ]);
    expect(rows_the_api_answers_with.sent_bodies).toEqual([]);
    expect(chat_from_top_to_bottom()).toEqual(['Today', 'my message', 'the answer', 'Working']);

    await read_the_api_again();
    expect(rows_the_api_answers_with.queued).toHaveLength(1);
    expect(chat_from_top_to_bottom()).toEqual(['Today', 'my message', 'the answer', 'Working']);

    rows_the_api_answers_with.queued = [];
    rows_the_api_answers_with.runs = [
      { ...run_row('completed'), run_id: 'run_2' },
      run_row('cancelled'),
    ];
    rows_the_api_answers_with.messages = [
      question,
      answer,
      {
        ...question,
        run_message_id: 'msg_3',
        run_id: 'run_2',
        message_sequence: 3,
        is_user_visible: false,
      },
      {
        ...answer,
        run_message_id: 'msg_4',
        run_id: 'run_2',
        message_sequence: 4,
        message_content: { type: 'text', text: 'Eight, again.' },
      },
    ];
    await read_the_api_again();
    await vi.waitFor(async () => {
      await settle();
      expect(chat_from_top_to_bottom()).toEqual([
        'Today',
        'my message',
        'the answer',
        'the new answer',
      ]);
    }, 8000);
  });
});

describe('the chat list when the answer of the open chat is done', () => {
  beforeEach(() => {
    rows_the_api_answers_with.sessions = [session_row('Planet count')];
    rows_the_api_answers_with.runs = [run_row('running')];
    rows_the_api_answers_with.messages = [
      message_row({ id: 'msg_1', role: 'user', text: typed_text, sequence: 1 }),
    ];
  });

  function chat_list_reads() {
    return vi
      .mocked(fetch)
      .mock.calls.filter(([input]) => new Request(input).url.endsWith('/v1/sessions')).length;
  }

  it('is told at once, so the sidebar does not say "Working" until its next poll', async () => {
    await mount_chat_page(session_id);
    const reads_while_working = chat_list_reads();

    rows_the_api_answers_with.runs = [run_row('completed')];
    rows_the_api_answers_with.sessions = [
      { ...session_row('Planet count'), session_status: 'completed' },
    ];
    act(() => void client.invalidateQueries({ queryKey: query_keys.runs(session_id) }));
    await settle();

    expect(chat_list_reads()).toBe(reads_while_working + 1);
    expect(client.getQueryData<Row[]>(query_keys.sessions())?.[0]?.session_status).toBe(
      'completed',
    );
  });
});
