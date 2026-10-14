// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorValue } from '@/components/app/automations/automation_editor_model';
import { TriggersPanel } from '@/components/app/automations/automation_editor_panels';
import type {
  AutomationTrigger,
  TriggerTypeCatalog,
} from '@/components/app/automations/automations_api';
import { ApiError } from '@/lib/api/client';

const list_trigger_field_choices = vi.hoisted(() => vi.fn());
vi.mock('@/components/app/automations/trigger_field_choices_api', () => ({
  list_trigger_field_choices,
}));

const slack_node = 'composio_slack-channel_message_received-1';
const calendar_node = 'googlecalendar-event_created-1';

function provider_field(name: string, label: string, words: Record<string, unknown> = {}) {
  return {
    name,
    label,
    description: null,
    required: false,
    type: 'string',
    has_default: false,
    chip_word: null,
    empty_means: null,
    unit: null,
    hidden_at_default: false,
    choices_from_provider: true,
    ...words,
  };
}

function app(app_id: string, name: string, connections: [string, string, string?][], row: unknown) {
  return {
    app_id,
    app_display_name: name,
    icon_url: null,
    connected: true,
    connection_id: connections[0]?.[0] ?? null,
    connections: connections.map(([connection_id, connection_name, account_label]) => ({
      account_label: account_label ?? null,
      connection_id,
      connection_name,
    })),
    trigger_types: [row],
  };
}

const slack_row = {
  node_key: slack_node,
  display_name: 'New message in a channel',
  display_name_without_app: 'New message in a channel',
  description: null,
  setup_fields: [provider_field('channel', 'Channel', { chip_word: 'in' })],
  input_schema: { properties: { channel: { type: 'string' } }, required: [] },
  event_fields: [],
  subject_field: 'thread_id',
};

const calendar_row = {
  node_key: calendar_node,
  display_name: 'Event created',
  display_name_without_app: 'Event created',
  description: null,
  setup_fields: [provider_field('calendarId', 'Calendar', { has_default: true })],
  input_schema: {
    properties: { calendarId: { type: 'string', default: 'primary' } },
    required: [],
  },
  event_fields: [],
  subject_field: 'event_id',
};

function catalog_with(slack_accounts: [string, string, string?][]) {
  return {
    common: [],
    apps: [
      app('composio_slack', 'Slack', slack_accounts, slack_row),
      app('googlecalendar', 'Google Calendar', [['conn_cal', 'Riley calendar']], calendar_row),
    ],
  } as unknown as TriggerTypeCatalog;
}

const two_slacks = catalog_with([
  ['conn_work', 'Work Slack'],
  ['conn_club', 'Club Slack'],
]);

function slack_trigger(connection_id: string | undefined, config: Record<string, unknown>) {
  return {
    key: 'trg_slack',
    input: {
      kind: 'app_event',
      node_key: slack_node,
      connection_id,
      subscription_config: config,
      conditions: [],
    },
  };
}

function value_with(...triggers: unknown[]): EditorValue {
  return {
    name: 'Team pings',
    instruction: 'tell me',
    rules: [],
    judge_question: '',
    saved_judge: null,
    budget: { max_fires_per_day: 50, max_no_progress_runs: 3 },
    run_policy: undefined,
    triggers,
  } as unknown as EditorValue;
}

function saved(value: EditorValue): EditorValue {
  return {
    ...value,
    triggers: value.triggers.map((trigger) => ({
      ...trigger,
      row: { trigger_id: trigger.key, trigger_status: 'enabled' } as AutomationTrigger,
    })),
  };
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let latest: EditorValue;

function Harness({ start, catalog }: { start: EditorValue; catalog: TriggerTypeCatalog }) {
  const [value, set_value] = useState(start);
  return createElement(TriggersPanel, {
    value,
    catalog,
    actions: undefined,
    onChange: (next: EditorValue) => {
      latest = next;
      set_value(next);
    },
  });
}

async function mount(value: EditorValue, catalog: TriggerTypeCatalog = two_slacks) {
  latest = value;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(Harness, { start: value, catalog }),
      ),
    );
  });
  await settle();
}

async function settle() {
  for (let round = 0; round < 5; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function box(trigger_key: string, field_name: string) {
  return document.getElementById(`trigger-setup-${trigger_key}-${field_name}`);
}

async function pick(trigger_key: string, field_name: string, option_text: string) {
  const trigger = box(trigger_key, field_name);
  if (!trigger) throw new Error(`no box ${field_name}`);
  await act(async () => trigger.click());
  await settle();
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (candidate) => candidate.textContent === option_text,
  );
  if (!option) throw new Error(`no option ${option_text}`);
  await act(async () => option.click());
  await settle();
}

function options_shown() {
  return [...document.querySelectorAll('[role="option"]')].map((option) => option.textContent);
}

function slack_input() {
  const input = latest.triggers[0]?.input;
  if (input?.kind !== 'app_event') throw new Error('no slack trigger');
  return input;
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  list_trigger_field_choices.mockReset();
  list_trigger_field_choices.mockImplementation(
    async (_node: string, _field: string, connection_id: string) =>
      connection_id === 'conn_work'
        ? [{ value: 'C_GENERAL', label: '#general' }]
        : [{ value: 'C_RUNS', label: '#sunday-runs' }],
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  for (const leftover of document.querySelectorAll('[role="listbox"]')) leftover.remove();
  vi.unstubAllGlobals();
});

describe('the Account box', () => {
  it('is not asked with one account, and the options load from that one', async () => {
    await mount(
      value_with(slack_trigger(undefined, {})),
      catalog_with([['conn_work', 'Work Slack']]),
    );
    expect(box('trg_slack', 'connection_id')).toBeNull();
    expect(list_trigger_field_choices).toHaveBeenCalledWith(slack_node, 'channel', 'conn_work');
  });

  it('is asked first with several accounts, names each, and writes the pick', async () => {
    await mount(value_with(slack_trigger(undefined, {})));
    expect(
      container.querySelector('label[for="trigger-setup-trg_slack-connection_id"]')?.textContent,
    ).toBe('Account');
    await pick('trg_slack', 'connection_id', 'Club Slack');
    expect(slack_input().connection_id).toBe('conn_club');
    expect(box('trg_slack', 'connection_id')?.textContent).toContain('Club Slack');
    expect(box('trg_slack', 'connection_id')?.textContent).not.toContain('conn_club');
  });
});

describe('a box whose options come from the provider', () => {
  it('stays shut until an account is picked, then loads only that account', async () => {
    await mount(value_with(slack_trigger(undefined, {})));
    const channel = box('trg_slack', 'channel');
    if (!channel) throw new Error('no channel box');
    expect(channel.hasAttribute('data-disabled')).toBe(true);
    expect(container.textContent).toContain('Choose an account to load its options.');
    expect(list_trigger_field_choices).not.toHaveBeenCalled();

    await pick('trg_slack', 'connection_id', 'Club Slack');
    expect(list_trigger_field_choices).toHaveBeenCalledTimes(1);
    expect(list_trigger_field_choices).toHaveBeenCalledWith(slack_node, 'channel', 'conn_club');
    expect(container.textContent).not.toContain('Choose an account to load its options.');
  });

  it('says Loading… while the provider has not answered', async () => {
    list_trigger_field_choices.mockImplementation(() => new Promise(() => undefined));
    await mount(value_with(slack_trigger('conn_work', {})));
    expect(box('trg_slack', 'channel')?.textContent).toContain('Loading…');
  });

  it('offers the loaded options and names the picked one, not its id', async () => {
    await mount(value_with(slack_trigger('conn_work', {})));
    await pick('trg_slack', 'channel', '#general');
    expect(slack_input().subscription_config).toEqual({ channel: 'C_GENERAL' });
    expect(box('trg_slack', 'channel')?.textContent).toContain('#general');
    expect(box('trg_slack', 'channel')?.textContent).not.toContain('C_GENERAL');
  });

  it('falls back to a plain box with the provider refusal under it', async () => {
    list_trigger_field_choices.mockRejectedValue(
      new ApiError('Slack is not answering right now. Try again in a minute.', 502),
    );
    await mount(value_with(slack_trigger('conn_work', {})));
    expect(box('trg_slack', 'channel')).toBeInstanceOf(HTMLInputElement);
    expect(container.textContent).toContain(
      'Slack is not answering right now. Try again in a minute.',
    );
  });

  it('falls back to a plain box when the account has nothing to pick', async () => {
    list_trigger_field_choices.mockResolvedValue([]);
    await mount(value_with(slack_trigger('conn_work', {})));
    expect(box('trg_slack', 'channel')).toBeInstanceOf(HTMLInputElement);
    expect(container.textContent).toContain('Nothing to pick from this account. Type it instead.');
  });

  it('empties its answer when the account changes, and keeps it when the same one is picked', async () => {
    await mount(value_with(slack_trigger('conn_work', { channel: 'C_GENERAL', other: 'x' })));
    await pick('trg_slack', 'connection_id', 'Work Slack');
    expect(slack_input().subscription_config).toEqual({ channel: 'C_GENERAL', other: 'x' });
    await pick('trg_slack', 'connection_id', 'Club Slack');
    expect(slack_input().connection_id).toBe('conn_club');
    expect(slack_input().subscription_config).toEqual({ other: 'x' });
  });

  it('offers the schema default the provider list leaves out, first, so it can be picked again', async () => {
    list_trigger_field_choices.mockResolvedValue([{ value: 'team@group', label: 'Team' }]);
    const calendar = {
      key: 'trg_cal',
      input: {
        kind: 'app_event',
        node_key: calendar_node,
        subscription_config: { calendarId: 'team@group' },
        conditions: [],
      },
    };
    await mount(value_with(calendar));
    await pick('trg_cal', 'calendarId', 'Default (primary)');
    const input = latest.triggers[0]?.input;
    expect(input?.kind === 'app_event' && input.subscription_config).toEqual({
      calendarId: 'primary',
    });
    await act(async () => box('trg_cal', 'calendarId')?.click());
    await settle();
    expect(options_shown()).toEqual(['Default (primary)', 'Team']);
  });
});

describe('the folded chips', () => {
  it('reads "account · <name>" with several accounts', async () => {
    await mount(saved(value_with(slack_trigger('conn_club', { channel: 'C_RUNS' }))));
    const chip = container.querySelector('[aria-label="Account: Club Slack"]');
    expect(chip?.textContent).toBe('account·Club Slack');
  });

  it('names a saved provider answer by its label after a reload, never the id', async () => {
    await mount(saved(value_with(slack_trigger('conn_club', { channel: 'C_RUNS' }))));
    expect(container.querySelector('[aria-label="Channel: #sunday-runs"]')).not.toBeNull();
    expect(container.textContent).not.toContain('C_RUNS');
  });
});

describe('what an account is called', () => {
  it('names an account by its mailbox address when the provider reports one', async () => {
    const catalog = catalog_with([
      ['conn_a', 'test', 'riley@example.com'],
      ['conn_b', 'x', 'riley@example.org'],
    ]);
    await mount(saved(value_with(slack_trigger('conn_b', {}))), catalog);
    const chip = container.querySelector('[aria-label="Account: riley@example.org"]');
    expect(chip?.textContent).toBe('account·riley@example.org');
    expect(container.textContent).not.toContain('account·x');
  });
});
