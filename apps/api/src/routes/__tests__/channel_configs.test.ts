import { create_app } from '@api/app';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { describe, expect, it } from 'vitest';

describe('channel config api routes', () => {
  it('creates, lists, and updates configured channels', async () => {
    const db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    const app = create_app(db);

    const create_response = await app.request('/v1/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        connection_id: 'conn_slack_test',
        channel_provider_key: 'slack',
        channel_name: '#engineering',
        external_account_id: 'T123',
        external_conversation_id: 'C123',
        conversation_scope: 'channel',
        routing_priority: 10,
        channel_config: {
          channel_policy: {
            require_bot_mention_in_channels: true,
            allowed_channel_ids: ['C123'],
          },
          context_policy: {
            recent_message_limit: 30,
          },
          delivery_policy: {
            stream_updates: true,
          },
        },
      }),
    });
    const created = (await create_response.json()).data;

    const workflow_response = await app.request('/v1/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel_provider_key: 'slack',
        target_kind: 'workflow',
        target_id: 'wf_customer_support',
        external_account_id: 'T123',
        external_conversation_id: 'C456',
        conversation_scope: 'channel',
      }),
    });
    const workflow_channel = (await workflow_response.json()).data;

    const list_response = await app.request('/v1/channels');
    const listed = (await list_response.json()).data;
    const patch_response = await app.request(`/v1/channels/${created.channel_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel_status: 'disabled' }),
    });
    const patched = (await patch_response.json()).data;

    expect(create_response.status).toBe(201);
    expect(created.channel_id).toMatch(/^chn_/);
    expect(created.channel_key).toMatch(/^engineering-[a-z0-9]{8}/);
    expect(created).toMatchObject({
      channel_provider_key: 'slack',
      channel_name: '#engineering',
      channel_status: 'enabled',
      connection_id: 'conn_slack_test',
      external_account_id: 'T123',
      external_conversation_id: 'C123',
      conversation_scope: 'channel',
      routing_priority: 10,
      target_kind: 'agent',
      target_id: bootstrap.agent_id,
      channel_config: {
        channel_policy: {
          require_bot_mention_in_channels: true,
          allowed_channel_ids: ['C123'],
        },
      },
      channel_target: {
        kind: 'agent_run',
        agent_id: bootstrap.agent_id,
      },
      channel_source: {
        channel_provider_key: 'slack',
        external_account_id: 'T123',
        external_conversation_id: 'C123',
        conversation_scope: 'channel',
      },
    });
    expect(workflow_response.status).toBe(201);
    expect(workflow_channel.channel_key).toMatch(/^c456-[a-z0-9]{8}/);
    expect(workflow_channel).toMatchObject({
      channel_provider_key: 'slack',
      target_kind: 'workflow',
      target_id: 'wf_customer_support',
      channel_target: {
        kind: 'workflow_run',
        workflow_id: 'wf_customer_support',
      },
    });
    expect(list_response.status).toBe(200);
    expect(listed).toHaveLength(2);
    expect(patch_response.status).toBe(200);
    expect(patched.channel_status).toBe('disabled');
  });
});
