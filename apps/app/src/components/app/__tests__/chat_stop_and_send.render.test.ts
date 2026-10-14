// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, createElement, type ReactNode, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chat_draft_key } from '@/components/app/chat_draft_storage';
import { useChatDraftStore } from '@/components/app/chat_draft_store';
import { useChatLiveStreamStore } from '@/components/app/chat_live_stream_store';
import { chat_user_message_class_name } from '@/components/app/chat_message';
import { useChatOptimisticMessageStore } from '@/components/app/chat_optimistic_message_store';
import { ChatSessionView } from '@/components/app/chat_session_view';
import { read_sidebar_chat_activity } from '@/components/app/sidebar_chat_activity';
import { list_sessions, type Session } from '@/lib/api';
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
const long_ago = new Date(Date.now() - 3_600_000).toISOString();

type Row = Record<string, unknown>;
type QueuedJob = { job_id: string; client_message_id: string; text: string; state: string };

const signed_in_person = {
  user: { id: 'user_1', email: 'dana@example.com', firstName: 'Dana', lastName: null },
  organizationId: null,
  impersonator: null,
};

const api = {
  session_status: 'completed',
  jobs: [] as QueuedJob[],
  runs: [] as Row[],
  messages: [] as Row[],
  stream_events_by_run: {} as Record<string, Row[]>,
  sent_bodies: [] as Row[],
  repeat_bodies: [] as Row[],
  stopped_run_ids: [] as string[],
  send_now_calls: 0,
  holds_send_answers: false,
  held_send_answers: [] as (() => void)[],
};

function reset_api() {
  Object.assign(api, {
    session_status: 'completed',
    jobs: [],
    runs: [],
    messages: [],
    stream_events_by_run: {},
    sent_bodies: [],
    repeat_bodies: [],
    stopped_run_ids: [],
    send_now_calls: 0,
    holds_send_answers: false,
    held_send_answers: [],
  });
  api.messages = [
    stored_message({
      role: 'assistant',
      text: 'Old answer.',
      run_id: 'run_0',
      created_time: long_ago,
    }),
  ];
}

function newest_run() {
  return api.runs[0];
}

function is_run_working(run: Row | undefined) {
  return run?.run_status === 'running';
}

function session_row(): Row {
  const run = newest_run();
  return {
    session_id,
    workspace_id: 'ws_1',
    agent_id: 'agent_1',
    project_id: null,
    session_title: 'Planet count',
    session_status: api.session_status,
    session_source: 'dashboard',
    source_type: 'dashboard',
    source_metadata: {},
    session_metadata: {},
    created_time: long_ago,
    last_updated_time: long_ago,
    latest_run: run
      ? { run_id: run.run_id, run_status: run.run_status, finished_time: long_ago }
      : null,
  };
}

function stored_message(input: {
  role: 'user' | 'assistant';
  text: string;
  run_id: string;
  client_message_id?: string;
  created_time?: string;
  is_user_visible?: boolean;
}): Row {
  const sequence = (api?.messages.length ?? 0) + 1;
  return {
    run_message_id: `msg_${sequence}`,
    session_id,
    workspace_id: 'ws_1',
    run_id: input.run_id,
    message_role: input.role,
    message_kind: input.role === 'user' ? 'input' : 'output',
    message_content: { type: 'text', text: input.text },
    message_sequence: sequence,
    run_message_sequence: sequence,
    is_user_visible: input.is_user_visible ?? true,
    is_model_visible: true,
    source_type: 'dashboard',
    source_metadata: input.client_message_id
      ? {
          client_message_id: input.client_message_id,
          source_actor: { source_actor_id: 'actor_1', profile: { display_name: 'Dana' } },
        }
      : {},
    metadata: {},
    created_time: input.created_time ?? a_moment_after_the_newest_stored_message(),
    last_updated_time: long_ago,
  };
}

function a_moment_after_the_newest_stored_message() {
  const newest_ms = Math.max(0, ...api.messages.map((row) => Date.parse(String(row.created_time))));
  return new Date(Math.max(Date.now(), newest_ms + 1)).toISOString();
}

function queued_messages_as_the_api_lists_them() {
  let is_one_ahead = is_run_working(newest_run());
  return api.jobs.map((job) => {
    const waiting_reason =
      job.state === 'paused' ? 'paused' : is_one_ahead ? 'session_busy' : 'starting';
    if (job.state === 'queued') is_one_ahead = true;
    return {
      job_id: job.job_id,
      client_message_id: job.client_message_id,
      preview_text: job.text,
      attachment_count: 0,
      created_time: long_ago,
      state: job.state,
      waiting_reason,
    };
  });
}

function json(data: unknown, status = 200) {
  return Response.json({ data }, { status });
}

async function take_sent_message(request: Request) {
  const body = (await request.json()) as Row;
  api.sent_bodies.push(body);
  const client_message_id = String(body.client_message_id);
  const known_job = api.jobs.find((job) => job.client_message_id === client_message_id);
  const job = known_job ?? {
    job_id: `ejob_${api.sent_bodies.length}`,
    client_message_id,
    text: String(body.message),
    state: 'queued',
  };
  if (!known_job) api.jobs.push(job);
  if (api.holds_send_answers) {
    await new Promise<void>((resolve) => api.held_send_answers.push(resolve));
  }
  return json(
    { job_id: job.job_id, session_id, waiting_reason: 'starting' },
    known_job ? 200 : 202,
  );
}

function stop_run(run_id: string) {
  const run = api.runs.find((item) => item.run_id === run_id);
  if (!run) return json(null, 404);
  api.stopped_run_ids.push(run_id);
  run.run_status = 'cancelled';
  api.session_status = 'cancelled';
  for (const job of api.jobs) if (job.state === 'queued') job.state = 'paused';
  return json(run);
}

async function answer_api_request(input: RequestInfo | URL, init?: RequestInit) {
  if (input === '/auth/session') return Response.json(signed_in_person);
  const request = new Request(input, init);
  const path = new URL(request.url).pathname.replace(/^\/api/u, '');
  const is_read = request.method === 'GET';
  const chat = `/v1/sessions/${session_id}`;
  if (path === '/v1/sessions' && is_read) return json([session_row()]);
  if (path === `${chat}/queued-messages` && is_read)
    return json(queued_messages_as_the_api_lists_them());
  if (path === `${chat}/queued-messages`) return take_sent_message(request);
  if (path === `${chat}/queued-messages/repeat`) {
    api.repeat_bodies.push((await request.json()) as Row);
    return json({ job_id: 'ejob_repeat', session_id, waiting_reason: 'starting' }, 202);
  }
  if (path === `${chat}/queued-messages/resume`) {
    api.send_now_calls += 1;
    for (const job of api.jobs) job.state = 'queued';
    return json({ resumed_job_ids: api.jobs.map((job) => job.job_id) });
  }
  if (path === `${chat}/runs`) return json(api.runs);
  if (path === `${chat}/messages`) return json({ items: api.messages, next_cursor: null });
  if (path === `${chat}/tool-calls`) return json([]);
  const run_path = /^\/v1\/runs\/([^/]+)\/(cancel|chat-stream-events)$/u.exec(path);
  if (run_path?.[2] === 'cancel') return stop_run(String(run_path[1]));
  if (run_path) return json(api.stream_events_by_run[String(run_path[1])] ?? []);
  return new Promise<Response>(() => undefined);
}

function take_job_of(text: string) {
  const job = api.jobs.find((item) => item.text === text);
  if (!job) throw new Error(`No queued message "${text}"`);
  api.jobs = api.jobs.filter((item) => item !== job);
  return job;
}

const client_message_id_by_run_id: Record<string, string> = {};

function the_run_starts_for(text: string, when: { stores_the_message: boolean }) {
  const job = take_job_of(text);
  const run_id = `run_${api.runs.length + 1}`;
  client_message_id_by_run_id[run_id] = job.client_message_id;
  api.runs = [
    { run_id, session_id, workspace_id: 'ws_1', run_status: 'running', created_time: long_ago },
    ...api.runs,
  ];
  api.session_status = 'running';
  if (when.stores_the_message) the_message_is_stored(text, run_id);
  return run_id;
}

function the_message_is_stored(text: string, run_id: string, created_time?: string) {
  const client_message_id = client_message_id_by_run_id[run_id];
  api.messages = [
    ...api.messages,
    stored_message({
      role: 'user',
      text,
      run_id,
      ...(created_time ? { created_time } : {}),
      ...(client_message_id ? { client_message_id } : {}),
    }),
  ];
}

function the_run_answers(run_id: string, text: string) {
  const run = api.runs.find((item) => item.run_id === run_id);
  if (run) run.run_status = 'completed';
  api.session_status = 'completed';
  api.messages = [...api.messages, stored_message({ role: 'assistant', text, run_id })];
}

let root: Root | null = null;
let client: QueryClient;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(answer_api_request));
  reset_api();
  useChatOptimisticMessageStore.setState({ optimistic_user_messages: [] });
  useChatLiveStreamStore.setState({ live_thread_by_session: {}, persisted_cursor_by_run: {} });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function ChatPageWithoutTheRouter() {
  const [open_session_id, set_open_session_id] = useState(session_id);
  const sessions_query = useQuery({ queryFn: list_sessions, queryKey: query_keys.sessions() });
  const open_session = sessions_query.data?.find((item) => item.session_id === open_session_id);
  return createElement(ChatSessionView, {
    onSessionReady: set_open_session_id,
    selectedSessionId: open_session_id,
    ...(open_session ? { selectedSession: open_session } : {}),
  });
}

async function settle(ms = 20) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

async function mount_chat_page() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const signed_in_page = createElement(
    AppAuthProvider,
    null,
    createElement(ChatPageWithoutTheRouter),
  );
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

function press(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) => item.getAttribute('aria-label') === label || item.textContent?.trim() === label,
  );
  if (!button) throw new Error(`No button "${label}"`);
  act(() => button.click());
}

function type_and_send(text: string) {
  act(() => useChatDraftStore.getState().set_draft(chat_draft_key(session_id), text));
  press('Send message');
}

const lines_under_a_message = new Set(['Queued', 'Paused', 'Send now', 'Old answer.']);

function chat_from_top_to_bottom() {
  const seen: string[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const element = node as HTMLElement;
    const own_text = element.childElementCount === 0 ? (element.textContent?.trim() ?? '') : '';
    if (element.className.startsWith(chat_user_message_class_name))
      seen.push(element.textContent ?? '');
    else if (element.getAttribute('role') === 'status' && element.textContent)
      seen.push(element.textContent.trim());
    else if (own_text.startsWith('Stopped.')) seen.push('Stopped');
    else if (own_text.startsWith('Answer to')) seen.push(own_text);
    else if (own_text.startsWith('The Nile')) seen.push('the stopped part of the answer');
    else if (/^(This message waits|These messages wait)/u.test(own_text)) seen.push('why it waits');
    else if (lines_under_a_message.has(own_text)) seen.push(own_text);
  }
  return seen;
}

function chat_list_row_says() {
  const [row] = client.getQueryData<Session[]>(query_keys.sessions()) ?? [];
  return row ? read_sidebar_chat_activity(row).label : 'no row';
}

function run_again_buttons_under_a_stopped_message() {
  return document.querySelectorAll('button[title="Run it again"]').length;
}

function composer_offers() {
  return document.querySelector('button[aria-label="Stop response"]') ? 'Stop' : 'Send';
}

describe('send, stop, send again, in quick succession', () => {
  it('keeps every message in send order, shows one state, and says why a message waits', async () => {
    await mount_chat_page();
    expect(chat_from_top_to_bottom()).toEqual(['Old answer.']);

    type_and_send('FOUR');
    await settle();
    await read_the_api_again();
    const run_four = the_run_starts_for('FOUR', { stores_the_message: true });
    await read_the_api_again();
    expect(chat_from_top_to_bottom()).toEqual(['Old answer.', 'FOUR', 'Working']);
    expect(chat_list_row_says()).toBe('Working');

    press('Stop response');
    await settle();
    expect(api.stopped_run_ids).toEqual([run_four]);
    expect(chat_from_top_to_bottom()).toEqual(['Old answer.', 'FOUR', 'Stopped']);
    expect(run_again_buttons_under_a_stopped_message()).toBe(1);
    expect([composer_offers(), chat_list_row_says()]).toEqual(['Send', 'Stopped']);

    type_and_send('FIVE');
    await settle();
    await read_the_api_again();
    const five_is_starting = ['Old answer.', 'FOUR', 'Stopped', 'FIVE', 'Working'];
    expect(chat_from_top_to_bottom()).toEqual(five_is_starting);
    expect(chat_list_row_says()).toBe('Working');

    press('Stop response');
    await settle();
    expect(api.stopped_run_ids).toEqual([run_four]);
    expect(chat_from_top_to_bottom()).toEqual(five_is_starting);
    const run_five = the_run_starts_for('FIVE', { stores_the_message: true });
    await settle(900);
    expect(api.stopped_run_ids).toEqual([run_four, run_five]);
    const five_is_stopped = ['Old answer.', 'FOUR', 'Stopped', 'FIVE', 'Stopped'];
    expect(chat_from_top_to_bottom()).toEqual(five_is_stopped);
    expect([composer_offers(), chat_list_row_says()]).toEqual(['Send', 'Stopped']);

    type_and_send('SIX');
    await settle();
    await read_the_api_again();
    const run_six = the_run_starts_for('SIX', { stores_the_message: false });
    await read_the_api_again();
    type_and_send('SEVEN');
    await settle();
    await read_the_api_again();
    const seven_waits_for_six = [...five_is_stopped, 'SIX', 'Working', 'SEVEN', 'Queued'];
    expect(chat_from_top_to_bottom()).toEqual(seven_waits_for_six);

    const after_seven_was_sent = new Date(Date.now() + 60_000).toISOString();
    the_message_is_stored('SIX', run_six, after_seven_was_sent);
    await read_the_api_again();
    expect(chat_from_top_to_bottom()).toEqual(seven_waits_for_six);

    the_run_answers(run_six, 'Answer to SIX');
    await read_the_api_again();
    const six_is_answered = [...five_is_stopped, 'SIX', 'Answer to SIX'];
    await vi.waitFor(async () => {
      await settle();
      expect(chat_from_top_to_bottom()).toEqual([...six_is_answered, 'SEVEN', 'Working']);
    }, 8000);
    expect(chat_list_row_says()).toBe('Working');

    const run_seven = the_run_starts_for('SEVEN', { stores_the_message: true });
    await read_the_api_again();
    type_and_send('EIGHT');
    await settle();
    await read_the_api_again();
    expect(chat_from_top_to_bottom()).toEqual([
      ...six_is_answered,
      'SEVEN',
      'Working',
      'EIGHT',
      'Queued',
    ]);

    press('Stop response');
    await settle();
    await read_the_api_again();
    expect(api.stopped_run_ids).toEqual([run_four, run_five, run_seven]);
    const eight_is_paused = ['EIGHT', 'Paused', 'why it waits', 'Send now'];
    const seven_is_stopped = [...six_is_answered, 'SEVEN', 'Stopped'];
    expect(chat_from_top_to_bottom()).toEqual([...seven_is_stopped, ...eight_is_paused]);
    expect([composer_offers(), chat_list_row_says()]).toEqual(['Send', 'Stopped']);

    type_and_send('NINE');
    await settle();
    await read_the_api_again();
    expect(chat_from_top_to_bottom()).toEqual([
      ...seven_is_stopped,
      'NINE',
      'Working',
      ...eight_is_paused,
    ]);
    expect([composer_offers(), chat_list_row_says()]).toEqual(['Stop', 'Working']);

    const run_nine = the_run_starts_for('NINE', { stores_the_message: true });
    await read_the_api_again();
    the_run_answers(run_nine, 'Answer to NINE');
    await read_the_api_again();
    const nine_is_answered = [...seven_is_stopped, 'NINE', 'Answer to NINE'];
    await vi.waitFor(async () => {
      await settle();
      expect(chat_from_top_to_bottom()).toEqual([...nine_is_answered, ...eight_is_paused]);
    }, 8000);
    expect(composer_offers()).toBe('Send');
    expect(chat_list_row_says()).not.toBe('Working');

    press('Send now');
    await settle();
    await read_the_api_again();
    expect(api.send_now_calls).toBe(1);
    expect(chat_from_top_to_bottom()).toEqual([...nine_is_answered, 'EIGHT', 'Working']);
    expect(chat_list_row_says()).toBe('Working');
  }, 60_000);

  it('sends two messages typed one right after the other as two messages', async () => {
    await mount_chat_page();
    api.holds_send_answers = true;

    type_and_send('ONE');
    type_and_send('TWO');
    await settle();
    expect(chat_from_top_to_bottom()).toEqual(['Old answer.', 'ONE', 'TWO', 'Working']);

    for (const answer_the_send of api.held_send_answers) answer_the_send();
    await settle();
    expect(api.sent_bodies.map((body) => body.message)).toEqual(['ONE', 'TWO']);
    expect(new Set(api.sent_bodies.map((body) => body.client_message_id)).size).toBe(2);
    expect(api.jobs.map((job) => job.text)).toEqual(['ONE', 'TWO']);
  });
});

describe('a run that was stopped, after a reload', () => {
  function stream_event(run_id: string, text: string): Row {
    return {
      event_id: `evt_${run_id}`,
      workspace_id: 'ws_1',
      session_id,
      run_id,
      sequence: 1,
      event_type: 'item_started',
      occurred_time: long_ago,
      source: { source_type: 'runtime_event', runtime_event_id: `evt_${run_id}` },
      item: {
        item_id: `${run_id}:assistant:0`,
        run_id,
        item_type: 'assistant_message',
        item_status: 'streaming',
        item_sequence: 1,
        role: 'assistant',
        parts: [{ type: 'text', text }],
        created_time: new Date().toISOString(),
        last_updated_time: new Date().toISOString(),
      },
    };
  }

  function a_stopped_run_with_question(text: string) {
    api.session_status = 'cancelled';
    api.runs = [
      {
        run_id: 'run_1',
        session_id,
        workspace_id: 'ws_1',
        run_status: 'cancelled',
        created_time: long_ago,
      },
    ];
    api.messages = [...api.messages, stored_message({ role: 'user', text, run_id: 'run_1' })];
  }

  it('says "Stopped" under a message that got no answer, and offers to run it again', async () => {
    a_stopped_run_with_question('FOUR');
    await mount_chat_page();

    expect(chat_from_top_to_bottom()).toEqual(['Old answer.', 'FOUR', 'Stopped']);
    const run_again = document.querySelector<HTMLButtonElement>('button[title="Run it again"]');
    if (!run_again) throw new Error('The stopped line has no button to run the message again');
    act(() => run_again.click());
    await settle();
    expect(api.repeat_bodies).toEqual([
      {
        run_message_id: api.messages.at(-1)?.run_message_id,
        client_message_id: expect.any(String),
      },
    ]);
  });

  it('keeps the part of the answer the stop cut off, through a new answer and after it', async () => {
    a_stopped_run_with_question('Tell me about rivers.');
    api.stream_events_by_run.run_1 = [stream_event('run_1', 'The Nile is the longest river')];
    await mount_chat_page();
    const stopped_answer = ['Tell me about rivers.', 'the stopped part of the answer', 'Stopped'];
    await vi.waitFor(async () => {
      await settle();
      expect(chat_from_top_to_bottom()).toEqual(['Old answer.', ...stopped_answer]);
    }, 8000);

    press('Regenerate response');
    await settle();
    api.runs = [
      {
        run_id: 'run_2',
        session_id,
        workspace_id: 'ws_1',
        run_status: 'running',
        created_time: long_ago,
      },
      ...api.runs,
    ];
    api.session_status = 'running';
    api.messages = [
      ...api.messages,
      stored_message({
        role: 'user',
        text: 'Tell me about rivers.',
        run_id: 'run_2',
        is_user_visible: false,
      }),
    ];
    await read_the_api_again();
    expect(chat_from_top_to_bottom()).toEqual(['Old answer.', ...stopped_answer, 'Working']);

    the_run_answers('run_2', 'Answer to the rivers question');
    await read_the_api_again();
    await vi.waitFor(async () => {
      await settle();
      expect(chat_from_top_to_bottom()).toEqual([
        'Old answer.',
        ...stopped_answer,
        'Answer to the rivers question',
      ]);
    }, 8000);
  });
});
