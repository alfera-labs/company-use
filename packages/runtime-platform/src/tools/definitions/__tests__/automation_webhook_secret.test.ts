import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { create_automation } from '@coworker/core/db/queries/automation_writes';
import { create_trigger } from '@coworker/core/db/queries/trigger_writes';
import { provision_workspace_for_identity } from '@coworker/core/db/queries/workspace_provisioning';
import {
  create_automation_tool,
  list_automations_tool,
} from '@runtime-platform/tools/definitions/automations';
import type { RuntimeToolExecutionContext } from '@runtime-platform/tools/types';
import { read_web_call_address } from '@runtime-platform/triggers/web_call_address';
import { describe, expect, it } from 'vitest';

const older_plain_secret = 'a'.repeat(43);
const provider_signing_secret = 'signing_secret_a_provider_gave_0123456789';

type ToolTrigger = { kind: string; webhook_url: string | null; webhook_secret: string | null };

async function create_runtime_context(): Promise<RuntimeToolExecutionContext> {
  const db = await create_test_database();
  const workspace = await provision_workspace_for_identity(db, {
    provider_key: 'workos',
    provider_user_id: 'user_secret_test',
    organization_id: 'org_secret_test',
    email: 'person@example.com',
  });
  return {
    db,
    workspace_id: workspace.workspace_id,
    session_id: 'ses_secret_test',
    run_id: 'run_secret_test',
    agent_id: workspace.agent_id,
    actor_id: workspace.user_id,
  };
}

async function seed_older_rows(context: RuntimeToolExecutionContext) {
  const owner = {
    workspace_id: context.workspace_id,
    agent_id: context.agent_id ?? '',
    actor_id: context.actor_id ?? '',
  };
  const automation = await create_automation(context.db, {
    ...owner,
    automation_name: 'Made before secrets were hidden',
    instruction: 'File what arrives.',
  });
  const shared = { ...owner, automation_id: automation.automation_id };
  await create_trigger(context.db, {
    ...shared,
    trigger_name: 'An older web call',
    trigger_type: 'webhook',
    trigger_config: { starts_job_handler: 'run_automation', webhook_secret: older_plain_secret },
  });
  await create_trigger(context.db, {
    ...shared,
    trigger_name: 'New records',
    trigger_type: 'app_event',
    trigger_config: {
      starts_job_handler: 'run_automation',
      provisioned_by: 'attio',
      webhook_secret: provider_signing_secret,
    },
  });
}

function triggers_in(result: unknown): ToolTrigger[] {
  const data = (result as { data: { automation?: unknown; automations?: unknown[] } }).data;
  const automations = (data.automations ?? [data.automation]) as { triggers: ToolTrigger[] }[];
  return automations.flatMap((automation) => automation.triggers);
}

describe('what the automation tools tell the model about a web-call secret', () => {
  it('gives the secret in the answer of the call that makes the trigger, and never when listing', async () => {
    const context = await create_runtime_context();

    const created = await create_automation_tool.execute(
      {
        name: 'Orders from the shop',
        instruction: 'Read the order and file it. Propose every reply before it is sent.',
        triggers: [{ kind: 'webhook' }],
      },
      context,
    );
    const listed = await list_automations_tool.execute({ include_paused: true }, context);
    const [made] = triggers_in(created);

    expect(made?.webhook_secret).toMatch(/^[a-f0-9]{64}$/);
    expect(made?.webhook_url).toContain('/v1/triggers/deliveries/webhook/');
    expect(triggers_in(listed).map((trigger) => trigger.webhook_secret)).toEqual([null]);
    expect(triggers_in(listed)[0]?.webhook_url).toBe(made?.webhook_url);
    expect(JSON.stringify(listed)).not.toContain(made?.webhook_secret);
  });

  it('never gives the stored secret of an older row, nor a signing secret a provider gave', async () => {
    const context = await create_runtime_context();
    await seed_older_rows(context);

    const listed = await list_automations_tool.execute({ include_paused: true }, context);

    expect(triggers_in(listed)).toHaveLength(2);
    expect(JSON.stringify(listed)).not.toContain(older_plain_secret);
    expect(JSON.stringify(listed)).not.toContain(provider_signing_secret);
  });
});

describe('what the create tool tells the model to say about the secret', () => {
  it('says the secret stays in the chat, and never that it is shown only once', () => {
    const words = create_automation_tool.description;

    expect(words).toContain('it stays in this chat');
    expect(words).toContain('anyone who can read this chat can read it');
    expect(words).toContain('Never say it is shown only once');
    expect(words).not.toContain('to the person once');
  });

  it('hands the model the address one function builds, with the note of an install that has no public address', async () => {
    const context = await create_runtime_context();

    const created = await create_automation_tool.execute(
      {
        name: 'Orders from the shop',
        instruction: 'Read the order and file it. Propose every reply before it is sent.',
        triggers: [{ kind: 'webhook' }],
      },
      context,
    );
    const [made] = triggers_in(created);
    const trigger_id = made?.webhook_url?.split('/').at(-1) ?? '';

    expect(made?.webhook_url).toBe(read_web_call_address(trigger_id).webhook_url);
    expect(made).toHaveProperty('webhook_url_note');
  });
});
