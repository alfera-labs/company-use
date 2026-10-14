import {
  create_automation,
  create_fixture,
  mail_ear,
  mock_the_provider_wire,
  provider,
  send,
} from '@api/routes/__tests__/automation_accounts_fixture';
import { create_project } from '@coworker/core/db/queries/projects';
import type { RuntimeToolExecutionContext } from '@runtime-platform/tools/types';
import { describe, expect, it } from 'vitest';

mock_the_provider_wire();

const { create_automation_tool, edit_automation_tool, list_trigger_types_tool } = await import(
  '@runtime-platform/tools/definitions/automations'
);

async function create_project_fixture() {
  const fixture = await create_fixture();
  const project = await create_project(fixture.db, {
    workspace_id: fixture.identity.workspace_id,
    project_name: 'Billing',
    owner_id: 'user_teammate',
    actor_id: 'user_teammate',
  });
  await fixture.connect('conn_project', 'user_teammate', '2026-09-01T00:00:00Z');
  await fixture.grant('conn_project', 'project', project.project_id);
  const run: RuntimeToolExecutionContext = {
    db: fixture.db,
    workspace_id: fixture.identity.workspace_id,
    session_id: 'ses_project',
    run_id: 'run_project',
    agent_id: fixture.identity.agent_id,
    actor_id: fixture.identity.user_id,
    participants: { project: [project.project_id], user: [fixture.identity.user_id], agent: [] },
    room_private_to: null,
  };
  return { ...fixture, run };
}

const answer_mail = { name: 'Answer mail', instruction: 'Draft a reply for the person to read.' };

describe("the run's gathering picks the account", () => {
  it("lists and accepts an account granted to the run's project", async () => {
    const fixture = await create_project_fixture();

    const listed = await list_trigger_types_tool.execute({}, fixture.run);
    const created = await create_automation_tool.execute(
      { ...answer_mail, triggers: [mail_ear({}, 'conn_project')] },
      fixture.run,
    );

    const rows = (listed as { data: { trigger_types: { connection_id: string | null }[] } }).data;
    expect(rows.trigger_types[0]?.connection_id).toBe('conn_project');
    expect(created).toMatchObject({ success: true });
    expect(provider.create).toHaveBeenCalledWith(
      expect.objectContaining({ connection_id: 'conn_project' }),
    );
  });

  it('accepts that account when the run edits an ear onto it', async () => {
    const fixture = await create_project_fixture();
    const created = await create_automation_tool.execute(
      { ...answer_mail, triggers: [{ kind: 'manual' }] },
      fixture.run,
    );
    const { automation } = (created as { data: { automation: { automation_id: string } } }).data;

    const edited = await edit_automation_tool.execute(
      {
        automation_id: automation.automation_id,
        triggers: [mail_ear({ label: 'B' }, 'conn_project')],
      },
      fixture.run,
    );

    expect(edited).toMatchObject({ success: true });
    expect(provider.create).toHaveBeenCalledWith(
      expect.objectContaining({ connection_id: 'conn_project' }),
    );
  });

  it('neither lists nor accepts that account on the HTTP route', async () => {
    const fixture = await create_project_fixture();

    const listed = await (await send(fixture, 'GET', '/v1/automations/trigger-types')).json();
    const refused = await create_automation(fixture, [mail_ear({}, 'conn_project')]);

    const gmail = listed.data.apps.find((app: { app_id: string }) => app.app_id === 'app_gmail');
    expect(gmail.connections).toEqual([]);
    expect(refused.status).toBe(403);
    expect(provider.create).not.toHaveBeenCalled();
  });

  it("refuses a teammate's private account from the tool, in words the model can repeat", async () => {
    const fixture = await create_project_fixture();
    await fixture.connect('conn_teammate', 'user_teammate', '2026-09-02T00:00:00Z');
    await fixture.grant('conn_teammate', 'user', 'user_teammate');

    const refused = await create_automation_tool.execute(
      { ...answer_mail, triggers: [mail_ear({}, 'conn_teammate')] },
      fixture.run,
    );

    expect(refused).toMatchObject({
      success: false,
      error: { code: 'access_denied', message: 'That connection is private to somebody else.' },
    });
    expect(provider.create).not.toHaveBeenCalled();
  });
});
