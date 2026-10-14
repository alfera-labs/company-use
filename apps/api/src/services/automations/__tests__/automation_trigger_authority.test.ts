import { create_app } from '@api/app';
import { build_automation_trigger_source } from '@api/services/automations/automation_trigger_authority';
import { build_scheduled_task_run_authority } from '@coworker/core';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import {
  type ApiKeyScope,
  create_api_key,
  revoke_api_key,
} from '@coworker/core/db/queries/api_keys';
import { get_automation } from '@coworker/core/db/queries/automation_reads';
import { list_automation_triggers } from '@coworker/core/db/queries/automation_triggers';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { set_policy } from '@coworker/core/db/queries/policies';
import { claim_card_unlock } from '@coworker/core/db/queries/rewards_state';
import { create_session } from '@coworker/core/db/queries/sessions';
import { create_id } from '@coworker/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { resolve_catalog_tool } = vi.hoisted(() => ({ resolve_catalog_tool: vi.fn() }));
vi.mock('@coworker/core/db/queries/catalog', async (import_original) => ({
  ...(await import_original<Record<string, unknown>>()),
  resolve_catalog_tool,
}));

const { execute_catalog_tool } = await import('@runtime-platform/tools/catalog_tool_execution');

describe('automation trigger authority', () => {
  const instruction = 'Answer billing questions and propose every reply.';

  it('signs for a person', () => {
    const source = build_automation_trigger_source({
      automation_id: 'atm_1',
      actor_id: 'user_01',
      instruction,
    });

    expect(source).toMatchObject({
      origin: 'automation',
      automation_id: 'atm_1',
      delegated_authority: { granted_by_actor_id: 'user_01', kind: 'scheduled_task' },
    });
  });

  it('signs for an API key, whose liveness the gate checks on every run', () => {
    const api_key_id = create_id('key');

    const source = build_automation_trigger_source({
      automation_id: 'atm_1',
      actor_id: api_key_id,
      instruction,
    });

    expect(source).toMatchObject({
      delegated_authority: { granted_by_actor_id: api_key_id, kind: 'scheduled_task' },
    });
  });

  it.each([
    'system:trigger',
    'agt_01',
    'key_not_a_real_id',
    'composio',
    '',
  ])('signs nothing for %s, so the trigger is unsigned and its runs are refused at the gate', (actor_id) => {
    const source = build_automation_trigger_source({
      automation_id: 'atm_1',
      actor_id,
      instruction,
    });

    expect(source).toEqual({ origin: 'automation', automation_id: 'atm_1' });
  });
});

describe('an automation an API key wrote', () => {
  let db: Database;
  let app: ReturnType<typeof create_app>;
  let workspace_id: string;
  let agent_id: string;
  let user_id: string;

  beforeEach(async () => {
    resolve_catalog_tool.mockReset().mockResolvedValue(manual_review_tool());
    db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    workspace_id = bootstrap.workspace_id;
    agent_id = bootstrap.agent_id;
    user_id = bootstrap.user_id;
    await claim_card_unlock(db, workspace_id);
    await set_policy(db, {
      workspace_id,
      resource_type: 'node',
      resource_id: 'gmail-send_email-1',
      scope_type: 'workspace',
      scope_id: workspace_id,
      policy_mode: 'allow',
      actor_id: user_id,
    });
    app = create_app(db);
  });

  async function mint_key(scopes: ApiKeyScope[] = ['automations.write']) {
    return create_api_key(db, {
      workspace_id,
      key_name: 'automation author',
      scopes,
      key_audience: 'internal',
      environment_label: 'test',
      actor_id: user_id,
    });
  }

  async function call(secret: string | null, method: string, path: string, body?: unknown) {
    const response = await app.request(path, {
      method,
      headers: {
        ...(secret ? { authorization: `Bearer ${secret}` } : {}),
        'content-type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return (await response.json()) as {
      data: { automation_id?: string; automation?: { automation_id: string } };
    };
  }

  async function create_automation(secret: string | null) {
    const created = await call(secret, 'POST', '/v1/automations', {
      automation_name: 'Ticket replies',
      instruction: 'Answer billing questions.',
      triggers: [{ kind: 'manual' }],
    });
    return created.data.automation_id ?? created.data.automation?.automation_id ?? '';
  }

  async function signers_of(automation_id: string) {
    const ears = await list_automation_triggers(db, { workspace_id, automation_id });
    return ears.map((ear) => ear.trigger_source?.delegated_authority?.granted_by_actor_id);
  }

  async function send_email_as_the_automation_run(automation_id: string) {
    const automation = await get_automation(db, { workspace_id, automation_id });
    const [ear] = await list_automation_triggers(db, { workspace_id, automation_id });
    if (!automation || !ear) throw new Error('the automation has no ear');
    const run_authority = build_scheduled_task_run_authority(
      ear.trigger_id,
      ear.trigger_source,
      automation.instruction,
    );
    const session = await create_session(db, { workspace_id, agent_id, actor_id: user_id });
    return execute_catalog_tool(db, {
      workspace_id,
      session_id: session.session_id,
      run_id: 'run_automation',
      actor_id: 'system:trigger',
      node_key: 'gmail-send_email-1',
      tool_input: {},
      source_context: {
        source_type: 'runtime',
        source_metadata: { automation_id, trigger_id: ear.trigger_id, ...run_authority },
      },
    });
  }

  it('lets its run act while the key is live, and refuses by name once the key is revoked', async () => {
    const { api_key, secret } = await mint_key();
    const automation_id = await create_automation(secret);
    expect(await signers_of(automation_id)).toEqual([api_key.api_key_id]);

    const while_live = await send_email_as_the_automation_run(automation_id);
    expect(while_live).toMatchObject({ error: { code: 'unsupported_catalog_tool' } });

    await revoke_api_key(db, { workspace_id, api_key_id: api_key.api_key_id, actor_id: user_id });
    const after_revoke = await send_email_as_the_automation_run(automation_id);
    expect(after_revoke).toMatchObject({
      success: false,
      error: {
        code: 'automation_signer_not_live',
        message: expect.stringContaining('save it again to sign it as yourself'),
      },
    });
  });

  it('keeps the grant of the signed-in test person through a key’s rename or pause, and hands it over on a behavior edit', async () => {
    const { api_key, secret } = await mint_key();
    const automation_id = await create_automation(null);
    const path = `/v1/automations/${automation_id}`;
    expect(await signers_of(automation_id)).toEqual([user_id]);

    await call(secret, 'PATCH', path, { automation_name: 'Tickets' });
    await call(secret, 'PATCH', path, { automation_status: 'paused' });
    await call(secret, 'PATCH', path, { automation_status: 'enabled' });
    expect(await signers_of(automation_id)).toEqual([user_id]);

    await call(secret, 'PATCH', path, {
      triggers: [{ kind: 'manual' }, { kind: 'schedule', cron: '0 7 * * *' }],
    });
    expect(await signers_of(automation_id)).toEqual([api_key.api_key_id, api_key.api_key_id]);

    await call(null, 'PATCH', path, { instruction: 'Answer every ticket by noon.' });
    expect(await signers_of(automation_id)).toEqual([user_id, user_id]);
    expect(await send_email_as_the_automation_run(automation_id)).toMatchObject({
      error: { code: 'unsupported_catalog_tool' },
    });
  });

  it('re-signs as the key when a key rewrites the instruction of the signed-in test person, instead of disarming it', async () => {
    const { api_key, secret } = await mint_key();
    const automation_id = await create_automation(null);

    await call(secret, 'PATCH', `/v1/automations/${automation_id}`, {
      instruction: 'Answer tickets in two lines.',
    });

    expect(await signers_of(automation_id)).toEqual([api_key.api_key_id]);
    expect(await send_email_as_the_automation_run(automation_id)).toMatchObject({
      error: { code: 'unsupported_catalog_tool' },
    });
  });
});

function manual_review_tool() {
  return {
    tool: {
      node_id: 'node_test',
      app_id: 'app_test',
      app_name: 'gmail',
      app_display_name: 'Gmail',
      node_name: 'send_email',
      node_key: 'gmail-send_email-1',
      runtime_handler: 'unsupported.fake_handler',
      approval_policy: { mode: 'manual_review' },
      auth_type: 'oauth',
      metadata: {},
    },
    connection: null,
    compatibility: { ok: true },
  };
}
