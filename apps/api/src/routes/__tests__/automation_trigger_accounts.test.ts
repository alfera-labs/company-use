import {
  create_automation,
  create_fixture,
  mail_ear,
  mock_the_provider_wire,
  provider,
  send,
  stored_ears,
} from '@api/routes/__tests__/automation_accounts_fixture';
import { describe, expect, it } from 'vitest';

mock_the_provider_wire();

describe('the account an app ear listens on', () => {
  it("defaults to my shared account, not a teammate's newer private one, on create and edit", async () => {
    const fixture = await create_fixture();
    await fixture.connect('conn_mine', fixture.identity.user_id, '2026-09-01T00:00:00Z');
    await fixture.connect('conn_teammate', 'user_teammate', '2026-09-20T00:00:00Z');
    await fixture.grant('conn_teammate', 'user', 'user_teammate');

    const response = await create_automation(fixture, [mail_ear({ label: 'INBOX' })]);
    expect(response.status).toBe(201);
    const automation_id = (await response.json()).data.automation.automation_id;
    const edited = await send(fixture, 'PATCH', `/v1/automations/${automation_id}`, {
      triggers: [mail_ear({ label: 'SENT' })],
    });

    expect(edited.status).toBe(200);
    const ears = await stored_ears(fixture, automation_id);
    expect(ears.map((ear) => ear.trigger_config.event_source?.connection_id)).toEqual([
      'conn_mine',
    ]);
    const wired_on = provider.create.mock.calls.map(([input]) => input.connection_id);
    expect(wired_on).toEqual(['conn_mine', 'conn_mine']);
  });

  it('refuses an account that is no longer connected instead of taking another one', async () => {
    const fixture = await create_fixture();
    await fixture.connect('conn_gone', fixture.identity.user_id, '2026-09-01T00:00:00Z');
    await fixture.revoke('conn_gone');
    await fixture.connect('conn_other', 'user_teammate', '2026-09-20T00:00:00Z');

    const response = await create_automation(fixture, [mail_ear({}, 'conn_gone')]);

    expect(response.status).toBe(422);
    expect((await response.json()).error.message).toBe('That account is no longer connected.');
    expect(provider.create).not.toHaveBeenCalled();
  });

  it('leaves an ear whose saved account went away in error when wired again', async () => {
    const fixture = await create_fixture();
    await fixture.connect('conn_gone', fixture.identity.user_id, '2026-09-01T00:00:00Z');
    provider.create.mockRejectedValueOnce(new Error('provider is down'));
    const created = await create_automation(fixture, [mail_ear({}, 'conn_gone')]);
    const automation_id = (await created.json()).data.automation.automation_id;
    await fixture.revoke('conn_gone');
    await fixture.connect('conn_other', 'user_teammate', '2026-09-20T00:00:00Z');

    const response = await send(fixture, 'POST', `/v1/automations/${automation_id}/provision`);

    expect(response.status).toBe(200);
    const [ear] = await stored_ears(fixture, automation_id);
    expect(ear?.trigger_status).toBe('error');
    expect(ear?.trigger_config.provisioning_error).toBe('That account is no longer connected.');
    expect(ear?.trigger_config.needs_connection).toBe('Gmail');
    expect(ear?.trigger_config.event_source?.connection_id).toBe('conn_gone');
    expect(provider.create).toHaveBeenCalledTimes(1);
  });

  it('marks only the ear whose saved account went private, and wires its siblings', async () => {
    const fixture = await create_fixture();
    await fixture.connect('conn_mine', fixture.identity.user_id, '2026-09-01T00:00:00Z');
    await fixture.connect('conn_teammate', 'user_teammate', '2026-09-02T00:00:00Z');
    provider.create.mockRejectedValue(new Error('provider is down'));
    const created = await create_automation(fixture, [
      mail_ear({ label: 'A' }, 'conn_mine'),
      mail_ear({ label: 'B' }, 'conn_teammate'),
    ]);
    const automation_id = (await created.json()).data.automation.automation_id;
    await fixture.grant('conn_teammate', 'user', 'user_teammate');
    provider.create.mockResolvedValue({ provisioning_key: 'wire_test' });

    const response = await send(fixture, 'POST', `/v1/automations/${automation_id}/provision`);

    expect(response.status).toBe(200);
    const ears = await stored_ears(fixture, automation_id);
    const on = (id: string) =>
      ears.find((ear) => ear.trigger_config.event_source?.connection_id === id);
    expect(on('conn_mine')?.trigger_status).toBe('enabled');
    expect(on('conn_mine')?.trigger_config.provisioning_key).toBe('wire_test');
    expect(on('conn_teammate')?.trigger_status).toBe('error');
    expect(on('conn_teammate')?.trigger_config.provisioning_error).toBe(
      'That connection is private to somebody else.',
    );
  });
});
