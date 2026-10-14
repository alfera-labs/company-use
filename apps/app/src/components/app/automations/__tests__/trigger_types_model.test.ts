import { describe, expect, it } from 'vitest';
import { new_trigger_input } from '@/components/app/automations/add_trigger_menu';
import type {
  AutomationTrigger,
  TriggerTypeApp,
  TriggerTypeCatalog,
  TriggerTypeRow,
} from '@/components/app/automations/automations_api';
import {
  describe_trigger_input,
  find_trigger_type,
  picker_apps,
  schedule_preset_rows,
  search_trigger_types,
  trigger_row_to_input,
} from '@/components/app/automations/trigger_types_model';

function row(node_key: string, display_name: string, description: string | null): TriggerTypeRow {
  return {
    node_key,
    display_name,
    app_name: node_key.split('-')[0] ?? 'app',
    description,
    setup_fields: [],
    event_fields: [],
    input_schema: {},
  } as unknown as TriggerTypeRow;
}

function app(fields: Partial<TriggerTypeApp> & { app_id: string }): TriggerTypeApp {
  return {
    app_name: fields.app_id,
    app_display_name: fields.app_id,
    icon_url: null,
    needs_connection: true,
    connected: true,
    connection_id: 'conn_1',
    trigger_types: [],
    ...fields,
  } as unknown as TriggerTypeApp;
}

const gmail = app({
  app_id: 'gmail',
  app_display_name: 'Gmail',
  trigger_types: [
    row('composio_gmail-new_gmail_message-1', 'New email in Gmail', 'Anything that lands'),
    row('composio_gmail-new_label-1', 'New label', null),
  ],
});

const stripe = app({
  app_id: 'stripe',
  app_display_name: 'Stripe',
  connected: false,
  connection_id: null,
  trigger_types: [
    row('stripe-payment_intent_payment_failed-1', 'Payment failed', 'A charge did not go through'),
    row('stripe-customer_created-1', 'Customer created', null),
  ],
});

const catalog: TriggerTypeCatalog = {
  count: 4,
  apps: [gmail, stripe],
} as unknown as TriggerTypeCatalog;

describe('Slack in the picker', () => {
  const slack = (app_name: string, node_key: string, connected = false) =>
    app({
      app_id: app_name,
      app_name,
      app_display_name: app_name === 'composio_slackbot' ? 'Slackbot' : 'Slack',
      connected,
      trigger_types: [row(node_key, 'New message', null)],
    });
  const with_slacks = {
    count: 7,
    apps: [
      gmail,
      slack('slack', 'slack-message_received-1'),
      slack('composio_slack', 'composio_slack-channel_message_received-1'),
      slack('composio_slackbot', 'composio_slackbot-channel_message_received-1'),
      stripe,
    ],
  } as unknown as TriggerTypeCatalog;

  it('shows Slack once, as our own Slack, everywhere a person can pick', () => {
    const apps = picker_apps(with_slacks);
    expect(apps.map((entry) => entry.app_name)).toEqual(['gmail', 'slack', 'stripe']);
    const found = search_trigger_types(with_slacks, 'slack');
    expect(found.groups.map((group) => group.app.app_name)).toEqual(['slack']);
    expect(found.total).toBe(5);
  });

  it("shows Composio's Slack instead once that is the one connected, and Slackbot once connected", () => {
    const connected = {
      count: 3,
      apps: [
        slack('slack', 'slack-message_received-1'),
        slack('composio_slack', 'composio_slack-channel_message_received-1', true),
        slack('composio_slackbot', 'composio_slackbot-channel_message_received-1', true),
      ],
    } as unknown as TriggerTypeCatalog;
    expect(picker_apps(connected).map((entry) => entry.app_name)).toEqual([
      'composio_slack',
      'composio_slackbot',
    ]);
  });

  it("still finds a saved automation on Composio's Slack", () => {
    expect(
      find_trigger_type(with_slacks, 'composio_slack-channel_message_received-1')?.app.app_name,
    ).toBe('composio_slack');
  });
});

describe('search_trigger_types', () => {
  it('counts the matches against the whole catalog and groups them by app', () => {
    const result = search_trigger_types(catalog, 'PAYMENT');

    expect(result.total).toBe(4);
    expect(result.matched).toBe(1);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.app.app_display_name).toBe('Stripe');
    expect(result.groups[0]?.rows.map((found) => found.display_name)).toEqual(['Payment failed']);
  });

  it('reads the description and the app name too, not only the trigger name', () => {
    expect(search_trigger_types(catalog, 'lands').matched).toBe(1);
    expect(search_trigger_types(catalog, 'gmail').matched).toBe(2);
  });

  it('shows nothing until something is typed', () => {
    expect(search_trigger_types(catalog, '  ')).toEqual({ matched: 0, total: 4, groups: [] });
  });
});

function trigger(fields: Partial<AutomationTrigger>): AutomationTrigger {
  return {
    trigger_id: 'trg_1',
    trigger_name: 'Mail arrives',
    trigger_type: 'app_event',
    trigger_status: 'enabled',
    schedule_expression: null,
    trigger_config: {},
    last_run_time: null,
    created_time: '2026-09-01T09:00:00.000Z',
    ...fields,
  } as unknown as AutomationTrigger;
}

describe('trigger_row_to_input', () => {
  it('says a saved schedule back as the input that would create it again', () => {
    const input = trigger_row_to_input(
      trigger({
        trigger_type: 'schedule',
        schedule_expression: '0 8 * * 1-5',
        trigger_config: { timezone: 'Europe/London' },
      }),
    );

    expect(input).toEqual({ kind: 'schedule', cron: '0 8 * * 1-5', timezone: 'Europe/London' });
  });

  it('leaves the timezone out when the row has none, so the API sees the same ear', () => {
    const input = trigger_row_to_input(
      trigger({ trigger_type: 'schedule', schedule_expression: '0 9 * * *' }),
    );

    expect(input).toEqual({ kind: 'schedule', cron: '0 9 * * *' });
  });

  it('carries a manual ear across as nothing but its kind', () => {
    expect(trigger_row_to_input(trigger({ trigger_type: 'manual' }))).toEqual({ kind: 'manual' });
  });

  it('keeps a saved webhook a webhook, so the next Save is not refused', () => {
    expect(trigger_row_to_input(trigger({ trigger_type: 'webhook' }))).toEqual({ kind: 'webhook' });
  });

  it('keeps an app event with its account, its setup and its rules', () => {
    const input = trigger_row_to_input(
      trigger({
        trigger_config: {
          event_source: {
            node_key: 'composio_gmail-new_gmail_message-1',
            connection_id: 'conn_1',
            subscription_config: { labelIds: 'INBOX' },
          },
          rules: [{ field: 'from', operation: 'is_not_any_of', values: ['me@example.com'] }],
        },
      }),
    );

    expect(input).toEqual({
      kind: 'app_event',
      node_key: 'composio_gmail-new_gmail_message-1',
      connection_id: 'conn_1',
      subscription_config: { labelIds: 'INBOX' },
      conditions: [{ field: 'from', operation: 'is_not_any_of', values: ['me@example.com'] }],
    });
  });
});

describe('describe_trigger_input', () => {
  it('reads an unsaved ear in the same words a saved one uses', () => {
    const said = describe_trigger_input(
      {
        kind: 'app_event',
        node_key: 'composio_gmail-new_gmail_message-1',
        subscription_config: { labelIds: 'INBOX' },
        conditions: [],
      },
      catalog,
    );

    expect(said).toEqual({ line: 'New email in Gmail', sub: 'INBOX' });
  });

  it('says a schedule in words and keeps the timezone next to it', () => {
    expect(describe_trigger_input({ kind: 'schedule', cron: '0 9 * * *' }, catalog)).toEqual({
      line: 'Every day at 9:00',
      sub: null,
    });
  });
});

describe('the Scheduled menu', () => {
  it('offers Hourly, Daily, Weekly and Custom, each landing as a schedule row', () => {
    expect(schedule_preset_rows.map((row) => row.display_name)).toEqual([
      'Hourly',
      'Daily',
      'Weekly',
      'Custom',
    ]);
    const [hourly, daily, weekly, custom] = schedule_preset_rows.map(new_trigger_input);
    expect(hourly).toMatchObject({ kind: 'schedule', cron: '0 * * * *' });
    expect(daily).toMatchObject({ kind: 'schedule', cron: '0 9 * * *' });
    expect(weekly).toMatchObject({ kind: 'schedule', cron: '0 9 * * 1' });
    expect(custom).toMatchObject({ kind: 'schedule' });
    expect(custom).toHaveProperty('cron', expect.any(String));
  });
});
