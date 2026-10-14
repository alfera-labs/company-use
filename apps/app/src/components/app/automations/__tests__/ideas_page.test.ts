// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Notification } from '@/components/app/automations/automations_api';
import { IdeasFile, OfferButton, offer_label } from '@/components/app/automations/ideas_page';
import { build_setup_request } from '@/components/app/automations/use_idea_actions';
import { useFileEditor } from '@/components/app/workspace_documents/use_file_editor';
import type { WorkspaceFileContent } from '@/lib/api';
import { ApiError } from '@/lib/api/client';
import { query_keys } from '@/lib/api/query_keys';

const idea = (proposed_action: unknown = { kind: 'none' }): Notification =>
  ({
    event_id: 'evt_1',
    notification: {
      title: 'You ask for the same weekly report',
      body: 'Three times in a month you asked for last week numbers.',
      proposed_action,
    },
  }) as unknown as Notification;

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function render(props: Parameters<typeof IdeasFile>[0]) {
  act(() => {
    root.render(createElement(IdeasFile, props));
  });
  return container.textContent ?? '';
}

it('starts the chat from the automation the agent proposed, in its own words', () => {
  const request = build_setup_request(
    idea({
      kind: 'create_automation',
      instruction: 'Every Monday at 09:00, send me last week numbers.',
    }),
  );

  expect(request).toContain('Every Monday at 09:00, send me last week numbers.');
  expect(request).toContain('mined_from_notification_id');
});

it('asks for the idea by name when no automation was proposed', () => {
  const request = build_setup_request(idea());

  expect(request).toContain('Set this up as an automation: You ask for the same weekly report.');
  expect(request).toContain('Three times in a month');
});

it('starts from the words of an offer kind this page does not know yet', () => {
  const offer = idea({
    kind: 'offer_later',
    instruction: 'Send the invoice',
    needs_apps: ['stripe'],
  });

  expect(build_setup_request(offer)).toBe('Send the invoice');
  expect(build_setup_request(idea({ kind: 'offer_later', instruction: '  ' }))).toContain(
    'Set this up as an automation:',
  );
});

it('reads a missing ideas.md as an empty page, not as an error', () => {
  const text = render({
    error: new ApiError('workspace_file_not_found', 404),
    isLoading: false,
    text: null,
    hasParkedIdeas: false,
  });

  expect(text).toBe('No ideas yet.');
});

it('says out loud when the file could not be read for any other reason', () => {
  const text = render({
    error: new ApiError('The volume is unreachable.', 500),
    isLoading: false,
    text: null,
    hasParkedIdeas: false,
  });

  expect(text).toBe('The volume is unreachable.');
});

it('answers an offer to act with yes, in the words the agent used', () => {
  const request = build_setup_request(
    idea({
      kind: 'offer_to_act',
      instruction: 'check you in for AZ1234 on Friday',
      needs_apps: ['gmail'],
    }),
  );

  expect(request).toBe('Yes, do it: check you in for AZ1234 on Friday');
});

it('offers one button per kind: yes for an act, the app for a connect', () => {
  expect(
    offer_label({
      kind: 'offer_to_act',
      instruction: 'check you in for AZ1234 on Friday',
      needs_apps: [],
    } as Notification['notification']['proposed_action']),
  ).toBe('Yes, do it');
  expect(
    offer_label({
      kind: 'connect_app',
      app_name: 'Stripe',
      reason: 'chase the payments that fail',
    } as Notification['notification']['proposed_action']),
  ).toBe('Connect Stripe');
  expect(offer_label({ kind: 'none' } as Notification['notification']['proposed_action'])).toBe(
    'Set it up',
  );
});

it('presses yes into the chat door, and says the offer on the button', () => {
  const pressed: string[] = [];
  const offer = idea({
    kind: 'offer_to_act',
    instruction: 'check you in for AZ1234 on Friday',
    needs_apps: [],
  });
  act(() => {
    root.render(createElement(OfferButton, { idea: offer, onSayYes: () => pressed.push('yes') }));
  });
  const button = container.querySelector('button');

  expect(button?.textContent).toBe('Yes, do it');
  act(() => {
    button?.click();
  });
  expect(pressed).toEqual(['yes']);
});

it('opens the chat to change the automation the review named', () => {
  const review = idea({
    kind: 'improve_automation',
    automation_id: 'atm_1',
    suggestion: 'stop the judge dropping threads with more than two replies',
  });

  expect(offer_label(review.notification.proposed_action)).toBe('Change it');
  expect(build_setup_request(review, 'Late payments')).toBe(
    'Change automation Late payments: stop the judge dropping threads with more than two replies',
  );
  expect(build_setup_request(review)).toContain('Change automation atm_1:');
});

it('shows the ideas the file editor just saved, not the copy it cached before', async () => {
  let server_text = 'Chase late invoices';
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (_url, init) => {
      if (init?.method === 'PUT') {
        server_text = JSON.parse(String(init.body)).content_text;
        return Response.json({
          data: { file_path: 'ideas.md', saved: true, content_version: 'v2' },
        });
      }
      return Response.json({
        data: { file_path: 'ideas.md', content_text: server_text, content_version: 'v1' },
      });
    }),
  );
  const client = new QueryClient();
  client.setQueryData(query_keys.workspace_file('ideas.md'), {
    file_path: 'ideas.md',
    content_text: 'Chase late invoices',
    content_version: 'v1',
  });
  let editor: ReturnType<typeof useFileEditor> | undefined;
  function Editor() {
    editor = useFileEditor('ws_1', 'ideas.md', false);
    return null;
  }
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client }, createElement(Editor)));
  });
  await vi.waitFor(() => expect(editor?.content?.content_text).toBe('Chase late invoices'));

  await act(async () => editor?.start_editing());
  await act(async () => editor?.change_text('Book the offsite'));
  await act(async () => editor?.save());

  expect(
    client.getQueryData<WorkspaceFileContent>(query_keys.workspace_file('ideas.md'))?.content_text,
  ).toBe('Book the offsite');
});
