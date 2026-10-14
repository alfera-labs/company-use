// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AddMcpServerDialog } from '@/components/app/add_mcp_server_dialog';

const refusal_of_a_local_address =
  'Alfera cannot reach a server on your own machine or network. Use an address on the public internet.';

const refusal_of_a_key =
  'The server did not accept this key. Check that the whole key was pasted. If the server wants the key under a header name, such as X-API-Key, fill in the header name, then add it again.';

const a_server_that_takes_a_key_and_offers_no_sign_in = {
  endpoint_url: 'https://notes.example.com/mcp',
  server_name: null,
  icon_url: null,
  description: null,
  authentication: 'always',
  offers_sign_in: false,
  supports_dynamic_registration: false,
};

let root: Root | null = null;
let sent_bodies: Array<{ path: string; body: Record<string, unknown> }> = [];

function answer_requests_with(answers: Record<string, () => Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: Request | string | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const path = new URL(request.url).pathname.replace(/^\/api/u, '');
      sent_bodies.push({ path, body: await request.clone().json() });
      const answer = answers[path];
      if (!answer) throw new Error(`No answer was set for ${path}`);
      return answer();
    }),
  );
}

function open_the_dialog(on_open_change: (open: boolean) => void = () => {}) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(AddMcpServerDialog, {
          open: true,
          on_open_change,
          on_added: () => {},
        }),
      ),
    ),
  );
}

function find_field(id: string) {
  const field = document.querySelector<HTMLInputElement>(`#${id}`);
  if (!field) throw new Error(`The field ${id} did not render`);
  return field;
}

async function type_into(field: HTMLInputElement, value: string) {
  const set_value = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    set_value?.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function give_the_address(address: string) {
  await type_into(find_field('mcp-server-url'), address);
  await act(async () => find_field('mcp-server-url').form?.requestSubmit());
}

function press_escape_in(field: HTMLElement) {
  return act(async () => {
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
}

function find_button(name: string) {
  const button = [...document.querySelectorAll('button')].find(
    (entry) => entry.textContent?.trim() === name,
  );
  if (!button) throw new Error(`The button "${name}" did not render`);
  return button;
}

const close_question = 'Close without adding this server? What you typed is not saved.';

async function reach_step_two_of_a_keyed_server(on_open_change?: (open: boolean) => void) {
  answer_requests_with({
    '/v1/mcp-servers/inspect': () =>
      Response.json({ data: a_server_that_takes_a_key_and_offers_no_sign_in }),
    '/v1/mcp-servers': () =>
      Response.json({
        data: { kind: 'connected', app_id: 'app_1', app_name: 'Notes', tool_count: tools_added },
      }),
  });
  open_the_dialog(on_open_change);
  await give_the_address('https://notes.example.com/mcp');
  await act(() => vi.waitFor(() => find_field('mcp-api-key')));
}

let tools_added = 1;

async function add_a_server_with(tool_count: number) {
  tools_added = tool_count;
  await reach_step_two_of_a_keyed_server();
  await type_into(find_field('mcp-api-key'), 'a-key');
  await act(async () => find_field('mcp-api-key').form?.requestSubmit());
  await act(() => vi.waitFor(() => find_button('Done')));
  return document.body.textContent ?? '';
}

function find_choice(title: string) {
  const label = [...document.querySelectorAll('label')].find((entry) =>
    entry.textContent?.startsWith(title),
  );
  if (!label) throw new Error(`The choice "${title}" did not render`);
  const radio = document.querySelector<HTMLInputElement>(`#${label.getAttribute('for')}`);
  if (!radio) throw new Error(`The choice "${title}" has no radio button`);
  return { label, radio };
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  sent_bodies = [];
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('the Add MCP server dialog', () => {
  it('keeps a refused address under the field, as the sentence the API gave, until the address changes', async () => {
    answer_requests_with({
      '/v1/mcp-servers/inspect': () =>
        Response.json(
          { error: { code: 'mcp_server_refused', message: refusal_of_a_local_address } },
          { status: 422 },
        ),
    });
    open_the_dialog();

    await give_the_address('http://localhost:8000/mcp');
    await act(() =>
      vi.waitFor(() => expect(document.querySelector('[role="alert"]')).not.toBeNull()),
    );

    const refusal = document.querySelector('[role="alert"]');
    expect(refusal?.textContent).toBe(refusal_of_a_local_address);
    expect(refusal?.id).toBe('mcp-server-url-refusal');
    expect(find_field('mcp-server-url').getAttribute('aria-describedby')).toBe(refusal?.id);
    expect(find_field('mcp-server-url').getAttribute('aria-invalid')).toBe('true');

    await type_into(find_field('mcp-server-url'), 'https://notes.example.com/mcp');
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it('starts on "I have an API key or token" and marks no sign-in as detected when the server offers none', async () => {
    answer_requests_with({
      '/v1/mcp-servers/inspect': () =>
        Response.json({ data: a_server_that_takes_a_key_and_offers_no_sign_in }),
    });
    open_the_dialog();

    await give_the_address('https://notes.example.com/mcp');
    await act(() => vi.waitFor(() => find_choice('I have an API key or token')));

    const key_choice = find_choice('I have an API key or token');
    expect(key_choice.radio.checked).toBe(true);
    expect(key_choice.label.textContent).toContain('Detected');
    expect(find_choice('Each person signs in').label.textContent).not.toContain('Detected');
    expect(document.body.textContent).not.toContain('Alfera registers itself');
    expect(find_field('mcp-api-key').type).toBe('password');
  });

  it('says at once that a header name is one Alfera sets itself, and does not send the add', async () => {
    answer_requests_with({
      '/v1/mcp-servers/inspect': () =>
        Response.json({ data: a_server_that_takes_a_key_and_offers_no_sign_in }),
    });
    open_the_dialog();
    await give_the_address('https://notes.example.com/mcp');
    await act(() => vi.waitFor(() => find_field('mcp-api-key')));

    await type_into(find_field('mcp-api-key'), 'a-key');
    await type_into(find_field('mcp-api-key-header-name'), 'Host');

    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      'Alfera sets the Host header itself. Take it out of the additional request headers.',
    );
    await act(async () => find_field('mcp-api-key').form?.requestSubmit());
    expect(sent_bodies.map((sent) => sent.path)).toEqual(['/v1/mcp-servers/inspect']);
  });

  it('sends the key as a bearer token, and under the header name when the person gives one', async () => {
    answer_requests_with({
      '/v1/mcp-servers/inspect': () =>
        Response.json({ data: a_server_that_takes_a_key_and_offers_no_sign_in }),
      '/v1/mcp-servers': () =>
        Response.json(
          {
            error: {
              code: 'mcp_server_refused',
              message: refusal_of_a_key,
            },
          },
          { status: 422 },
        ),
    });
    open_the_dialog();
    await give_the_address('https://notes.example.com/mcp');
    await act(() => vi.waitFor(() => find_field('mcp-api-key')));

    await type_into(find_field('mcp-api-key'), 'a-key');
    await act(async () => find_field('mcp-api-key').form?.requestSubmit());
    await act(() =>
      vi.waitFor(() =>
        expect(document.querySelector('[role="alert"]')?.textContent).toBe(refusal_of_a_key),
      ),
    );
    await type_into(find_field('mcp-api-key-header-name'), 'X-API-Key');
    expect(document.querySelector('[role="alert"]')).toBeNull();
    await act(async () => find_field('mcp-api-key').form?.requestSubmit());
    await act(() => vi.waitFor(() => expect(sent_bodies).toHaveLength(3)));

    expect(sent_bodies.slice(1).map((sent) => sent.body)).toEqual([
      {
        server_url: 'https://notes.example.com/mcp',
        authentication: 'none',
        access_token: 'a-key',
      },
      {
        server_url: 'https://notes.example.com/mcp',
        authentication: 'none',
        request_headers: [{ name: 'X-API-Key', value: 'a-key' }],
      },
    ]);
  });

  it('asks before Escape drops a typed key, keeps the key on "Keep editing", and closes on the other answer', async () => {
    const on_open_change = vi.fn();
    await reach_step_two_of_a_keyed_server(on_open_change);

    await press_escape_in(find_field('mcp-api-key'));
    expect(on_open_change).toHaveBeenCalledWith(false);
    expect(document.body.textContent).not.toContain(close_question);

    on_open_change.mockClear();
    await give_the_address('https://notes.example.com/mcp');
    await act(() => vi.waitFor(() => find_field('mcp-api-key')));
    await type_into(find_field('mcp-api-key'), 'a-key-typed-once');
    await press_escape_in(find_field('mcp-api-key'));

    expect(on_open_change).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(close_question);
    expect(find_field('mcp-api-key').value).toBe('a-key-typed-once');
    expect(document.body.textContent).not.toContain('Add server');

    await act(async () => find_button('Keep editing').click());
    expect(document.body.textContent).not.toContain(close_question);
    expect(find_field('mcp-api-key').value).toBe('a-key-typed-once');
    expect(find_button('Add server').disabled).toBe(false);

    await press_escape_in(find_field('mcp-api-key'));
    await act(async () => find_button('Close without adding').click());
    expect(on_open_change).toHaveBeenCalledWith(false);
    expect(document.querySelector('#mcp-api-key')).toBeNull();
    expect(find_field('mcp-server-url').value).toBe('');
  });

  it('says "it" for one tool and "them" for several', async () => {
    const one = await add_a_server_with(1);
    expect(one).toContain('1 tool added. Your coworker can use it now');
    expect(one).not.toContain('them');
    act(() => root?.unmount());
    document.body.innerHTML = '';

    const three = await add_a_server_with(3);
    expect(three).toContain('3 tools added. Your coworker can use them now');
    act(() => root?.unmount());
    document.body.innerHTML = '';

    const none = await add_a_server_with(0);
    expect(none).toContain('The server lists no tools yet');
    expect(none).not.toContain('0 tools');
  });

  it('says step two in plain words, and folds what few servers need', async () => {
    await reach_step_two_of_a_keyed_server();

    const step = document.querySelector('form')?.textContent ?? '';
    for (const jargon of ['OAuth flow', 'Transport:', 'bearer token', 'credentials']) {
      expect(step).not.toContain(jargon);
    }
    const folded = document.querySelector('details');
    expect(folded?.open).toBe(false);
    expect(folded?.querySelector('summary')?.textContent).toBe('More options');
    expect(folded?.textContent).toContain('Additional request headers');
    expect(folded?.textContent).toContain('Streamable HTTP');
  });
});
