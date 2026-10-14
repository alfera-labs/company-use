import {
  audit,
  choices_url,
  create_fixture,
  restrict_connection,
} from '@api/routes/__tests__/trigger_choices_fixture';
import { connections } from '@coworker/core/db/schema';
import type * as executors from '@runtime-platform/tools/catalog_tool_executors';
import { describe, expect, it, vi } from 'vitest';

const provider_call = vi.hoisted(() => vi.fn<executors.CatalogToolExecutor>());
vi.mock('@runtime-platform/tools/catalog_tool_executors', async (import_original) => ({
  ...(await import_original<typeof executors>()),
  find_catalog_tool_executor: () => provider_call,
}));

describe('automation trigger provider choices', () => {
  it('lists all active Gmail connections newest first', async () => {
    const fixture = await create_fixture();
    await fixture.db.insert(connections).values({
      connection_id: 'conn_new',
      workspace_id: fixture.identity.workspace_id,
      app_id: 'app_mail',
      connection_key: 'gmail_new',
      connection_status: 'active',
      connection_name: 'Work inbox',
      created_time: new Date('2030-01-01'),
      ...audit,
    });
    const response = await fixture.app.request('/v1/automations/trigger-types');
    const mail = (await response.json()).data.apps.find(
      (app: { app_name: string }) => app.app_name === 'gmail',
    );
    expect(mail.connections).toEqual([
      { connection_id: 'conn_new', connection_name: 'Work inbox', account_label: null },
      {
        connection_id: 'conn_mail',
        connection_name: 'Personal inbox',
        account_label: 'Personal inbox',
      },
    ]);
    expect(mail.connection_id).toBe('conn_new');
  });

  it('offers only the connections this person may use', async () => {
    const fixture = await create_fixture();
    await restrict_connection(fixture, 'conn_teammate', 'user_teammate');
    await restrict_connection(fixture, 'conn_mine', fixture.identity.user_id);

    const response = await fixture.app.request('/v1/automations/trigger-types');
    const mail = (await response.json()).data.apps.find(
      (app: { app_name: string }) => app.app_name === 'gmail',
    );
    const offered = mail.connections.map((row: { connection_id: string }) => row.connection_id);
    expect(offered).toEqual(expect.arrayContaining(['conn_mail', 'conn_mine']));
    expect(offered).not.toContain('conn_teammate');
    expect(mail.connections).toContainEqual({
      connection_id: 'conn_mine',
      connection_name: 'Gmail',
      account_label: null,
    });
  });

  it('runs the action on the trigger app with the selected connection', async () => {
    const fixture = await create_fixture();
    provider_call.mockResolvedValue({
      success: true,
      data: {
        node_key: 'composio_gmail-list_labels-1',
        app_name: 'composio_gmail',
        node_name: 'list_labels',
        output: {
          labels: [
            { id: 'Label_12', name: 'Work' },
            { id: 'INBOX', name: 'Inbox' },
          ],
        },
      },
    });
    const response = await fixture.app.request(choices_url);
    expect(response.status).toBe(200);
    expect((await response.json()).data.choices).toEqual([
      { value: 'INBOX', label: 'Inbox' },
      { value: 'Label_12', label: 'Work' },
    ]);
    const [, call, tool, connection] = provider_call.mock.lastCall ?? [];
    expect(call).toMatchObject({
      node_key: 'gmail-labels-in-this-env-7',
      connection_id: 'conn_mail',
      workspace_id: fixture.identity.workspace_id,
      actor_id: fixture.identity.user_id,
    });
    expect(tool?.node_key).toBe('gmail-labels-in-this-env-7');
    expect(connection?.connection_id).toBe('conn_mail');
  });

  it('returns 404 when the field has no provider choices', async () => {
    const fixture = await create_fixture();
    const response = await fixture.app.request(choices_url.replace('labelIds', 'query'));
    expect(response.status).toBe(404);
    expect((await response.json()).error.message).toContain('no provider choices');
  });

  it('rejects a connection outside the trigger app', async () => {
    provider_call.mockClear();
    const fixture = await create_fixture();
    const response = await fixture.app.request(choices_url.replace('conn_mail', 'other_account'));
    expect(response.status).toBe(404);
    expect(provider_call).not.toHaveBeenCalled();
  });

  it('requires a connection id in the query', async () => {
    const fixture = await create_fixture();
    const response = await fixture.app.request(choices_url.split('?')[0] ?? '');
    expect(response.status).toBe(422);
  });

  it('returns the provider message with status 502', async () => {
    const fixture = await create_fixture();
    provider_call.mockResolvedValue({
      success: false,
      error: { code: 'expired', message: 'Reconnect the Gmail account.' },
    });
    const response = await fixture.app.request(choices_url);
    expect(response.status).toBe(502);
    expect((await response.json()).error.message).toBe('Reconnect the Gmail account.');
  });

  it('answers 403 when the connection is private to somebody else', async () => {
    provider_call.mockClear();
    const fixture = await create_fixture();
    await restrict_connection(fixture, 'conn_teammate', 'user_teammate');
    const response = await fixture.app.request(choices_url.replace('conn_mail', 'conn_teammate'));
    expect(response.status).toBe(403);
    expect((await response.json()).error).toMatchObject({
      code: 'access_denied',
      message: 'That connection is private to somebody else.',
    });
    expect(provider_call).not.toHaveBeenCalled();
  });
});
