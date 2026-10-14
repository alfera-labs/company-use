import { create_app } from '@api/app';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { apps, connections, nodes } from '@coworker/core/db/schema';
import { describe, expect, it } from 'vitest';

const audit = { created_by: 'test', last_updated_by: 'test' };

async function create_fixture() {
  const db = await create_test_database();
  const identity = await bootstrap_default_workspace(db);
  await db.insert(apps).values([
    {
      app_id: 'app_mail',
      app_name: 'mail_fixture',
      app_key: 'mail_fixture',
      app_display_name: 'Mail fixture',
      auth_type: 'oauth',
      metadata: { icon_url: 'https://logos.example.com/mail.svg' },
      ...audit,
    },
    {
      app_id: 'app_pay',
      app_name: 'pay_fixture',
      app_key: 'pay_fixture',
      app_display_name: 'Pay fixture',
      auth_type: 'oauth',
      display_config: { icon_url: 'https://logos.example.com/pay.svg' },
      ...audit,
    },
    {
      app_id: 'app_native',
      app_name: 'alfera_email',
      app_key: 'alfera_email',
      app_display_name: 'Alfera email',
      auth_type: 'none',
      ...audit,
    },
  ]);
  await db.insert(nodes).values([
    {
      ...trigger_node(
        'node_mail',
        'app_mail',
        'mail_fixture',
        'message_received',
        'Message Received Trigger',
        {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Gmail search' },
            labelIds: { type: 'string' },
            interval: { type: 'number' },
            userId: { type: 'string', default: 'me' },
          },
        },
      ),
      node_config: {
        composio: { toolkit_slug: 'gmail', trigger_slug: 'GMAIL_NEW_GMAIL_MESSAGE' },
        sourced_from: { provider: 'composio', provider_app_id: 'gmail' },
      },
    },
    trigger_node(
      'node_pay_failed',
      'app_pay',
      'pay_fixture',
      'payment_failed',
      'Pay Fixture Payment Failed',
      { type: 'object', properties: { query: { type: 'string' } } },
    ),
    trigger_node('node_pay_ok', 'app_pay', 'pay_fixture', 'payment_succeeded', 'Payment succeeded'),
    {
      ...trigger_node(
        'node_native',
        'app_native',
        'alfera_email',
        'message_received',
        'Someone emails your coworker',
      ),
      runtime_handler: 'native.trigger.email_received',
      node_config: { subject_field: 'thread_id' },
      metadata: {
        description: 'Someone emails your coworker',
        data_fields: ['thread_id', 'sender'],
      },
    },
    {
      node_id: 'node_mail_send',
      app_id: 'app_mail',
      app_key: 'mail_fixture',
      node_name: 'send_message',
      node_key: 'mail_fixture-send_message-1',
      node_display_name: 'Send message',
      node_kind: 'action',
      input_schema: {},
      runtime_handler: 'composio.action.SEND',
      ...audit,
    },
  ]);
  await db.insert(connections).values({
    connection_id: 'conn_mail',
    workspace_id: identity.workspace_id,
    app_id: 'app_mail',
    connection_key: 'mail_fixture',
    connection_status: 'active',
    external_account_id: 'account_mail',
    ...audit,
  });
  return { db, identity, app: create_app(db) };
}

function trigger_node(
  node_id: string,
  app_id: string,
  app_key: string,
  node_name: string,
  display_name: string,
  input_schema: Record<string, unknown> = {},
) {
  return {
    node_id,
    app_id,
    app_key,
    node_name,
    node_key: `${app_key}-${node_name}-1`,
    node_display_name: display_name,
    node_kind: 'trigger',
    input_schema,
    runtime_handler: `composio.trigger.${node_name.toUpperCase()}`,
    node_config: { composio: { toolkit_slug: app_key, trigger_slug: node_name.toUpperCase() } },
    metadata: { description: `${display_name} in ${app_key}` },
    ...audit,
  };
}

describe('GET /v1/automations/trigger-types', () => {
  it('groups every trigger node by app, with a Connect state per app and the schema per row', async () => {
    const fixture = await create_fixture();

    const response = await fixture.app.request('/v1/automations/trigger-types');
    const body = (await response.json()).data;

    expect(response.status).toBe(200);
    expect(body.count).toBe(4);
    expect(body.apps.map((app: { app_name: string }) => app.app_name)).toEqual([
      'alfera_email',
      'mail_fixture',
      'pay_fixture',
    ]);

    const mail = body.apps.find((app: { app_name: string }) => app.app_name === 'mail_fixture');
    expect(mail).toMatchObject({
      app_display_name: 'Mail fixture',
      icon_url: 'https://logos.example.com/mail.svg',
      needs_connection: true,
      connected: true,
      connection_id: 'conn_mail',
    });
    expect(mail.trigger_types).toEqual([
      expect.objectContaining({
        node_key: 'mail_fixture-message_received-1',
        display_name: 'Message received',
        display_name_without_app: 'Message received',
        description: 'Message Received Trigger in mail_fixture',
        // The words each field reads with come from the server, keyed by provider app and field.
        // (Postgres jsonb hands the schema's keys back shortest first.)
        setup_fields: [
          {
            name: 'query',
            label: 'Only emails matching',
            description:
              'A Gmail search, like from:billing@example.com or subject:invoice. Leave empty for all mail.',
            required: false,
            type: 'string',
            has_default: false,
            chip_word: 'matching',
            empty_means: 'all mail',
            unit: null,
            hidden_at_default: false,
            choices_from_provider: false,
            minimum: null,
          },
          {
            name: 'userId',
            label: 'User id',
            description: null,
            required: false,
            type: 'string',
            has_default: true,
            chip_word: null,
            empty_means: null,
            unit: null,
            hidden_at_default: true,
            choices_from_provider: false,
            minimum: null,
          },
          {
            name: 'interval',
            label: 'Check every (minutes)',
            description: 'How often Alfera looks for new ones. 1 minute or more.',
            required: false,
            type: 'number',
            has_default: false,
            chip_word: 'every',
            empty_means: null,
            unit: 'min',
            hidden_at_default: false,
            choices_from_provider: false,
            minimum: 1,
          },
          {
            name: 'labelIds',
            label: 'Label',
            description:
              'Only emails with this label. For several, use the search above: label:work OR label:clients.',
            required: false,
            type: 'string',
            has_default: false,
            chip_word: 'in',
            empty_means: null,
            unit: null,
            hidden_at_default: false,
            choices_from_provider: true,
            minimum: null,
          },
        ],
        input_schema: expect.objectContaining({ properties: expect.any(Object) }),
      }),
    ]);

    const pay = body.apps.find((app: { app_name: string }) => app.app_name === 'pay_fixture');
    expect(pay).toMatchObject({
      icon_url: 'https://logos.example.com/pay.svg',
      needs_connection: true,
      connected: false,
      connection_id: null,
    });
    expect(
      pay.trigger_types.map((row: { display_name: string; display_name_without_app: string }) => [
        row.display_name,
        row.display_name_without_app,
      ]),
    ).toEqual([
      ['Pay fixture payment failed', 'Payment failed'],
      ['Payment succeeded', 'Payment succeeded'],
    ]);
    expect(pay.trigger_types[0].setup_fields[0]).toMatchObject({
      name: 'query',
      chip_word: null,
      empty_means: null,
    });

    const native = body.apps.find((app: { app_name: string }) => app.app_name === 'alfera_email');
    expect(native).toMatchObject({ needs_connection: false, connected: true, icon_url: null });
    expect(native.trigger_types[0].event_fields).toEqual([
      { name: 'thread_id', label: 'Thread id' },
      { name: 'sender', label: 'Sender' },
    ]);
  });
});
