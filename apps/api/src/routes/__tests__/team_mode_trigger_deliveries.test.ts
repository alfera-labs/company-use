import {
  as_person,
  call,
  db,
  main_agent_id,
  sign_the_owner_in,
  use_a_fresh_team_install,
} from '@api/routes/__tests__/team_mode_install';
import { create_trigger } from '@coworker/core/db/queries/trigger_writes';
import { describe, expect, it } from 'vitest';

use_a_fresh_team_install();

const secret_of_the_trigger = 'a'.repeat(43);

async function web_call_trigger_of_the_owner() {
  const owner = await sign_the_owner_in();
  const workspace = await call('GET', '/v1/workspace', as_person(owner.user_id));
  return create_trigger(db, {
    workspace_id: String(workspace.data.workspace_id),
    agent_id: await main_agent_id(as_person(owner.user_id)),
    trigger_name: 'A web call',
    trigger_type: 'webhook',
    trigger_config: {
      starts_job_handler: 'run_automation',
      webhook_secret: secret_of_the_trigger,
    },
    trigger_status: 'enabled',
    actor_id: owner.user_id,
  });
}

function web_call_with(secret: string) {
  return { 'content-type': 'application/json', authorization: `Bearer ${secret}` };
}

async function call_with_no_test_runner_identity(path: string, secret: string) {
  const runner_marks = { VITEST: process.env.VITEST, worker: process.env.VITEST_WORKER_ID };
  delete process.env.VITEST;
  delete process.env.VITEST_WORKER_ID;
  try {
    return await call('POST', path, web_call_with(secret), {});
  } finally {
    if (runner_marks.VITEST !== undefined) process.env.VITEST = runner_marks.VITEST;
    if (runner_marks.worker !== undefined) process.env.VITEST_WORKER_ID = runner_marks.worker;
  }
}

describe('a web call to an install in team mode', () => {
  it('reaches its trigger with the secret of the trigger alone: no person is signed in', async () => {
    const trigger = await web_call_trigger_of_the_owner();
    const path = `/v1/triggers/deliveries/webhook/${trigger.trigger_id}`;

    const answer = await call_with_no_test_runner_identity(path, secret_of_the_trigger);

    expect(answer.status).toBe(202);
  });

  it('is refused with a wrong secret, by the rule of the delivery and not by the rule for people', async () => {
    const trigger = await web_call_trigger_of_the_owner();
    const path = `/v1/triggers/deliveries/webhook/${trigger.trigger_id}`;

    const answer = await call_with_no_test_runner_identity(path, 'b'.repeat(43));

    expect(answer.status).toBe(401);
    expect(answer.error?.message).not.toContain('proxy');
  });
});
