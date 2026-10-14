// @vitest-environment happy-dom

import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type EditorValue,
  editor_is_complete,
} from '@/components/app/automations/automation_editor_model';
import { TriggersPanel } from '@/components/app/automations/automation_editor_panels';
import type {
  AutomationTrigger,
  TriggerTypeCatalog,
} from '@/components/app/automations/automations_api';
import type { EditorPageActions } from '@/components/app/automations/connect_app_button';

function api_field(name: string, words: Record<string, unknown> = {}) {
  return {
    name,
    label: name,
    description: null,
    required: false,
    type: 'string',
    has_default: false,
    chip_word: null,
    empty_means: null,
    unit: null,
    hidden_at_default: false,
    ...words,
  };
}

const catalog = {
  common: [],
  apps: [
    {
      app_id: 'composio_gmail',
      app_display_name: 'Gmail',
      icon_url: null,
      connected: true,
      connection_id: 'conn_1',
      trigger_types: [
        {
          node_key: 'composio_gmail-new_gmail_message-1',
          display_name: 'New Gmail message received',
          display_name_without_app: 'New message received',
          description: null,
          setup_fields: [
            api_field('query', {
              label: 'Query',
              has_default: true,
              chip_word: 'matching',
              empty_means: 'all mail',
            }),
            api_field('labelIds', { label: 'Labels', has_default: true, chip_word: 'in' }),
            api_field('format', { label: 'Format' }),
            api_field('interval', {
              label: 'Interval',
              has_default: true,
              chip_word: 'every',
              unit: 'min',
            }),
            api_field('userId', { label: 'User id', has_default: true, hidden_at_default: true }),
          ],
          input_schema: {
            properties: {
              query: { type: 'string', title: 'Query', default: '' },
              labelIds: { type: 'string', title: 'Labels', default: 'INBOX' },
              format: { type: 'string', title: 'Format', enum: ['full', 'minimal'] },
              interval: { type: 'integer', title: 'Interval', default: 2, minimum: 1 },
              userId: { type: 'string', title: 'User id', default: 'me' },
            },
            required: [],
          },
          event_fields: [],
          subject_field: 'thread_id',
        },
      ],
    },
    {
      app_id: 'composio_slack',
      app_display_name: 'Slack',
      icon_url: null,
      connected: true,
      connection_id: 'conn_2',
      trigger_types: [
        {
          node_key: 'composio_slack-channel_message_received-1',
          display_name: 'New message in a channel',
          display_name_without_app: 'New message in a channel',
          description: null,
          setup_fields: [api_field('channel', { label: 'Channel' })],
          input_schema: {
            properties: { channel: { type: 'string', title: 'Channel' } },
            required: ['channel'],
          },
          event_fields: [],
          subject_field: 'thread_id',
        },
      ],
    },
    {
      app_id: 'googlecalendar',
      app_display_name: 'Google Calendar',
      icon_url: null,
      connected: true,
      connection_id: 'conn_3',
      trigger_types: [
        {
          node_key: 'googlecalendar-event_offset-1',
          display_name: 'Event starts soon',
          display_name_without_app: 'Event starts soon',
          description: null,
          setup_fields: [
            api_field('relative_to', { label: 'Relative to' }),
            api_field('offsetMinutes', { label: 'Offset minutes' }),
          ],
          input_schema: {
            properties: {
              relative_to: { type: 'string', enum: ['start', 'end'] },
              offsetMinutes: { type: 'integer', minimum: 1 },
            },
            required: [],
          },
          event_fields: [],
          subject_field: 'event_id',
        },
        {
          node_key: 'googlecalendar-event_created-1',
          display_name: 'Event created',
          display_name_without_app: 'Event created',
          description: null,
          setup_fields: [],
          input_schema: { properties: {}, required: [] },
          event_fields: [],
          subject_field: 'event_id',
        },
      ],
    },
  ],
} as unknown as TriggerTypeCatalog;

const agent_made: EditorValue = {
  name: 'Tech email alerts',
  instruction: 'ping me',
  rules: [],
  judge_question: '',
  budget: { max_fires_per_day: 50, max_no_progress_runs: 3 },
  triggers: [
    {
      key: 'trg_gmail',
      input: {
        kind: 'app_event',
        node_key: 'composio_gmail-new_gmail_message-1',
        connection_id: 'conn_1',
        subscription_config: { query: '(technology OR tech)', labelIds: 'INBOX' },
        conditions: [],
      },
    },
    { key: 'trg_cron', input: { kind: 'schedule', cron: '30 9 * * 1,2,3,4,5' } },
  ],
} as unknown as EditorValue;

const waiting_for_a_channel: EditorValue = {
  ...agent_made,
  triggers: [
    {
      key: 'trg_slack',
      input: {
        kind: 'app_event',
        node_key: 'composio_slack-channel_message_received-1',
        connection_id: 'conn_2',
        subscription_config: {},
        conditions: [],
      },
    },
  ],
} as unknown as EditorValue;

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let latest: EditorValue = agent_made;

function Harness({
  start,
  actions,
}: {
  start: EditorValue;
  actions: EditorPageActions | undefined;
}) {
  const [value, set_value] = useState(start);
  return createElement(TriggersPanel, {
    value,
    catalog,
    actions,
    onChange: (next: EditorValue) => {
      latest = next;
      set_value(next);
    },
  });
}

function mount(value: EditorValue, actions?: EditorPageActions) {
  latest = value;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(createElement(Harness, { start: value, actions })));
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function click(label: string) {
  const button = container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
  if (!button) throw new Error(`no button ${label}`);
  act(() => button.click());
}

function click_text(text: string) {
  const button = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === text,
  );
  if (!button) throw new Error(`no button ${text}`);
  act(() => button.click());
}

function box(trigger_key: string, field_name: string) {
  return document.getElementById(`trigger-setup-${trigger_key}-${field_name}`);
}

function type_into(trigger_key: string, field_name: string, text: string) {
  const input = box(trigger_key, field_name);
  if (!(input instanceof HTMLInputElement)) throw new Error(`no box ${field_name}`);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function form_of(title: string) {
  return container.querySelector(`fieldset[aria-label="${title} settings"]`);
}

function done_button() {
  return [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === 'Done',
  );
}

function schedule_chip() {
  const chips = [...container.querySelectorAll<HTMLButtonElement>('[aria-label^="Edit "]')];
  const chip = chips.at(-1);
  if (!chip) throw new Error('no schedule chip');
  return chip;
}

const gmail_title = 'New Gmail message received';

describe('a saved trigger with nothing to fix', () => {
  it('stays folded and says every setup box as one chip: a muted word and the answer', () => {
    mount(saved(agent_made));
    expect(form_of(gmail_title)).toBeNull();
    const row = container.textContent ?? '';
    expect(row).toContain('matching');
    expect(row).toContain('(technology OR tech)');
    expect(row).toContain('Inbox');
    expect(row).not.toContain('(technology OR tech), INBOX');
  });

  it('names each chip by its box and its answer', () => {
    mount(saved(agent_made));
    expect(container.querySelector('[aria-label="Query: (technology OR tech)"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Labels: Inbox"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Format: any"]')).not.toBeNull();
  });

  it('opens the form on the pressed chip, with that box focused and its answer in it', () => {
    mount(saved(agent_made));
    click('Labels: Inbox');
    expect(form_of(gmail_title)).not.toBeNull();
    const labels = box('trg_gmail', 'labelIds') as HTMLInputElement | null;
    expect(labels?.value).toBe('INBOX');
    expect(document.activeElement).toBe(labels);
  });

  it('opens the form from Edit on its first box', () => {
    mount(saved(agent_made));
    click(`Edit ${gmail_title} settings`);
    expect(document.activeElement).toBe(box('trg_gmail', 'query'));
  });

  it('shows the schema default in an empty chip and hides the userId convention', () => {
    mount(saved(with_config({})));
    expect(container.querySelector('[aria-label="Query: all mail"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Labels: Inbox"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Interval: 2 min"]')).not.toBeNull();
    expect(container.querySelector('[aria-label^="User id"]')).toBeNull();
  });

  it('shows a changed userId as a chip', () => {
    mount(saved(with_config({ userId: 'someone@example.org' })));
    expect(container.querySelector('[aria-label="User id: someone@example.org"]')).not.toBeNull();
  });

  it('calls an empty optional box "any" rather than leaving a gap', () => {
    mount(saved(with_config({ query: '(technology OR tech)' })));
    expect(container.querySelector('[aria-label="Format: any"]')).not.toBeNull();
  });
});

describe('the settings form', () => {
  it('opens by itself for a just-added trigger with a required box, and says Required there', () => {
    mount(waiting_for_a_channel);
    const form = form_of('New message in a channel');
    expect(form).not.toBeNull();
    expect(form?.querySelector('label')?.textContent).toBe('ChannelRequired');
    expect(form?.querySelector('.text-caution-ink')?.textContent).toBe('Required');
    expect(done_button()?.disabled).toBe(true);
    expect(form?.textContent).toContain('Fix Channel first');
    expect(editor_is_complete(waiting_for_a_channel, catalog)).toBe(false);
  });

  it('stays open on a saved trigger whose required box is empty', () => {
    mount(saved(waiting_for_a_channel));
    expect(form_of('New message in a channel')).not.toBeNull();
  });

  it('opens by itself on a saved trigger whose number breaks a bound', () => {
    mount(saved(with_config({ interval: 0 })));
    expect(form_of(gmail_title)?.textContent).toContain('At least 1');
  });

  it('writes every change straight into the draft, keeping the other answers and the other ear', () => {
    mount(agent_made);
    type_into('trg_gmail', 'query', '(robotics)');
    expect(latest.triggers.map((trigger) => trigger.key)).toEqual(['trg_gmail', 'trg_cron']);
    const edited = latest.triggers[0]?.input;
    expect(edited?.kind === 'app_event' && edited.subscription_config).toEqual({
      query: '(robotics)',
      labelIds: 'INBOX',
    });
  });

  it('says "At least 1" under a number below the minimum and keeps Save out of reach', () => {
    mount(saved(with_config({})));
    click('Interval: 2 min');
    type_into('trg_gmail', 'interval', '0.5');
    expect(form_of(gmail_title)?.textContent).toContain('At least 1');
    expect(done_button()?.disabled).toBe(true);
    expect(editor_is_complete(latest, catalog)).toBe(false);
  });

  it('folds into chips on Done only once every box is fine', () => {
    mount(waiting_for_a_channel);
    const title = 'New message in a channel';
    act(() => done_button()?.click());
    expect(form_of(title)).not.toBeNull();

    type_into('trg_slack', 'channel', '#support');
    expect(done_button()?.disabled).toBe(false);
    click_text('Done');
    expect(form_of(title)).toBeNull();
    expect(container.querySelector('[aria-label="Channel: #support"]')).not.toBeNull();
  });

  it('gives each box a visible label', () => {
    mount(agent_made);
    expect(container.querySelector('label[for="trigger-setup-trg_gmail-query"]')?.textContent).toBe(
      'Query',
    );
  });

  it('says a field with no title in words, in the form and on its chip', () => {
    const calendar = {
      ...agent_made,
      triggers: [
        {
          key: 'trg_cal',
          input: {
            kind: 'app_event',
            node_key: 'googlecalendar-event_offset-1',
            subscription_config: { relative_to: 'end', offsetMinutes: 5 },
            conditions: [],
          },
        },
      ],
    } as unknown as EditorValue;
    mount(calendar);
    const form = container.textContent ?? '';
    expect(form).toContain('Relative to');
    expect(form).toContain('Offset minutes');
    expect(form).not.toContain('relative_to');
    click_text('Done');
    expect(container.querySelector('[aria-label="Relative to: end"]')?.textContent).toContain(
      'relative to',
    );
  });

  it('draws neither a form nor Edit for a trigger with nothing to set up', () => {
    mount({
      ...agent_made,
      triggers: [
        {
          key: 'trg_created',
          input: {
            kind: 'app_event',
            node_key: 'googlecalendar-event_created-1',
            subscription_config: {},
            conditions: [],
          },
        },
      ],
    } as unknown as EditorValue);
    expect(container.querySelector('fieldset')).toBeNull();
    expect(container.querySelector('[aria-label$=" settings"]')).toBeNull();
  });

  it('opens a schedule ear with its cron already in the builder, and Back changes nothing', () => {
    mount(agent_made);
    act(() => schedule_chip().click());
    expect(document.body.textContent).toMatch(/weekday/i);
    const back = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Back',
    );
    act(() => back?.click());
    expect(latest).toBe(agent_made);
  });

  it("names the trigger with the API's own name, not a re-worded one", () => {
    mount(agent_made);
    expect(container.textContent).toContain(gmail_title);
    expect(container.textContent).not.toContain('Message Received');
  });
});

describe('a trigger the provider refused', () => {
  const refused = {
    trigger_id: 'trg_gmail',
    trigger_status: 'error',
    trigger_config: { provisioning_error: 'Gmail has no label "CLIENT_MAIL" to watch.' },
  } as unknown as AutomationTrigger;

  it('opens the form with the reason on top, as sent, and Try again', async () => {
    const retry_trigger_setup = vi.fn(async () => undefined);
    mount(with_row(refused), { retry_trigger_setup });

    const top = form_of(gmail_title)?.firstElementChild?.textContent ?? '';
    expect(top).toContain('Gmail has no label "CLIENT_MAIL" to watch.');
    expect(container.textContent).not.toContain('Start listening');
    await act(async () => click_text('Try again'));
    expect(retry_trigger_setup).toHaveBeenCalledOnce();
  });

  it('says only "Not running." when the reason is not words', () => {
    const odd = { ...refused, trigger_config: { provisioning_error: 42 } } as unknown;
    mount(with_row(odd as AutomationTrigger), {
      retry_trigger_setup: vi.fn(async () => undefined),
    });
    click_text('Done');
    expect(container.textContent).toContain('Not running.');
    expect(container.textContent).toContain('Try again');
  });

  it('keeps the reason under the row once the form is folded', () => {
    mount(with_row(refused), { retry_trigger_setup: vi.fn(async () => undefined) });
    click_text('Done');
    expect(form_of(gmail_title)).toBeNull();
    expect(container.textContent).toContain('Try again');
  });

  it('says nothing about running on a trigger that runs', () => {
    mount(with_row({ trigger_id: 'trg_gmail', trigger_status: 'enabled' } as AutomationTrigger), {
      retry_trigger_setup: vi.fn(async () => undefined),
    });
    expect(container.textContent).not.toContain('Try again');
  });
});

function saved(value: EditorValue): EditorValue {
  return {
    ...value,
    triggers: value.triggers.map((trigger) => ({
      ...trigger,
      row: { trigger_id: trigger.key, trigger_status: 'enabled' } as AutomationTrigger,
    })),
  };
}

function with_config(subscription_config: Record<string, unknown>): EditorValue {
  const [gmail] = agent_made.triggers;
  if (gmail?.input.kind !== 'app_event') throw new Error('no gmail trigger');
  return {
    ...agent_made,
    triggers: [{ ...gmail, input: { ...gmail.input, subscription_config } }],
  };
}

function with_row(row: AutomationTrigger): EditorValue {
  const [gmail] = agent_made.triggers;
  if (!gmail) throw new Error('no gmail trigger');
  return { ...agent_made, triggers: [{ ...gmail, row }] };
}

describe('provider conventions in the form', () => {
  it('keeps userId out of the form while it holds the default, like the chip does', () => {
    mount(agent_made);
    expect(container.querySelector('fieldset')).not.toBeNull();
    expect(container.textContent).not.toContain('User Id');
    expect(container.textContent).toContain('Query');
  });
});
