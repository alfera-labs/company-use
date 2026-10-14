import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { get_automation } from '@coworker/core/db/queries/automation_reads';
import { claim_card_unlock } from '@coworker/core/db/queries/rewards_state';
import { provision_workspace_for_identity } from '@coworker/core/db/queries/workspace_provisioning';
import { build_automation_run_instruction } from '@runtime-platform/automations/automation_run_instruction';
import {
  create_automation_tool,
  edit_automation_tool,
} from '@runtime-platform/tools/definitions/automations';
import type { RuntimeToolExecutionContext } from '@runtime-platform/tools/types';
import { describe, expect, it } from 'vitest';

const customer_replies = {
  name: 'Answer billing questions',
  instruction: 'Send the customer the approved first reply, then email the owner.',
  triggers: [{ kind: 'manual' as const }],
};

async function person_in_chat(): Promise<RuntimeToolExecutionContext> {
  const db = await create_test_database();
  const workspace = await provision_workspace_for_identity(db, {
    provider_key: 'workos',
    provider_user_id: 'user_owner',
    organization_id: 'org_owner',
    email: 'owner@example.com',
    first_name: 'Owner',
  });
  await claim_card_unlock(db, workspace.workspace_id);
  return {
    db,
    workspace_id: workspace.workspace_id,
    session_id: 'ses_owner',
    run_id: 'run_owner',
    agent_id: workspace.agent_id,
    actor_id: workspace.user_id,
  };
}

function automation_id_of(result: unknown) {
  return (result as { data: { automation: { automation_id: string } } }).data.automation
    .automation_id;
}

async function run_policy_of(context: RuntimeToolExecutionContext, automation_id: string) {
  const automation = await get_automation(context.db, {
    workspace_id: context.workspace_id,
    automation_id,
  });
  return automation?.run_policy;
}

describe('an automation the person lets send without asking', () => {
  it('keeps the flag the person set on create, and edits it without losing the budget', async () => {
    const context = await person_in_chat();
    const created = await create_automation_tool.execute(
      { ...customer_replies, sends_without_asking: true },
      context,
    );
    const automation_id = automation_id_of(created);
    expect(created).toMatchObject({ data: { automation: { sends_without_asking: true } } });
    expect(await run_policy_of(context, automation_id)).toMatchObject({
      sends_without_asking: true,
    });

    await context.db.execute(
      `update automations set run_policy = run_policy || '{"budget": {"max_fires_per_day": 300, "max_no_progress_runs": 100}}' where automation_id = '${automation_id}'`,
    );
    await edit_automation_tool.execute({ automation_id, sends_without_asking: false }, context);

    expect(await run_policy_of(context, automation_id)).toMatchObject({
      sends_without_asking: false,
      budget: { max_fires_per_day: 300, max_no_progress_runs: 100 },
    });
  });

  it('cannot be turned on by a background run', async () => {
    const context = await person_in_chat();
    const automation_id = automation_id_of(
      await create_automation_tool.execute(customer_replies, context),
    );

    const edited = await edit_automation_tool.execute(
      { automation_id, sends_without_asking: true },
      { ...context, actor_id: 'system:trigger', source_context: { source_type: 'runtime' } },
    );

    expect(edited).toMatchObject({ success: false, error: { code: 'ask_the_person' } });
    expect((await run_policy_of(context, automation_id))?.sends_without_asking).toBeUndefined();
  });

  it('tells the run to do its own sends instead of stopping at an approval', () => {
    const run = (sends_without_asking: boolean) =>
      build_automation_run_instruction({
        automation_name: 'Answer billing questions',
        instruction: customer_replies.instruction,
        subject_value: 'thread 1',
        subject_is_known: false,
        subject_is_resolved: false,
        sends_without_asking,
      });

    expect(run(true)).toContain('Do the sends this instruction describes on your own');
    expect(run(true)).not.toContain('propose it and stop at the approval');
    expect(run(false)).toContain('propose it and stop at the approval');
    expect(run(false)).not.toContain('Do the sends this instruction describes on your own');
  });
});
