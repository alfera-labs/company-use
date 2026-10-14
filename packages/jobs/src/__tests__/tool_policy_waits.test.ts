import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import {
  consume_tool_policy_approval,
  create_tool_policy_wait,
  hash_tool_input_for_approval,
  policy_decision_event_type,
  tool_policy_wait_subject,
} from '@coworker/core/db/queries/event_waits';
import { enqueue_event_jobs } from '@coworker/core/db/queries/events';
import { create_session } from '@coworker/core/db/queries/sessions';
import { claim_ready_event_jobs_for_queue } from '@coworker/jobs/queries/event_job_claims';
import { describe, expect, it } from 'vitest';

describe('tool policy waits', () => {
  it('uses a canonical tool input hash', () => {
    const tool_input = { amount: 240, order: { id: '4471', currency: 'USD' } };
    expect(hash_tool_input_for_approval({ order: tool_input.order, amount: 240 })).toBe(
      hash_tool_input_for_approval(tool_input),
    );
  });

  it('stays unclaimable and wakes once on a matching event', async () => {
    const fixture = await wait_fixture();
    expect(fixture.wait.event_job.job_status).toBe('waiting');
    expect(await claim(fixture)).toEqual([]);

    const decision = await approve_wait(fixture);
    expect(decision.event_jobs).toHaveLength(1);
    expect(decision.event_jobs[0]?.event_id).toBe(decision.event.event_id);
    expect((await claim(fixture))[0]?.job_status).toBe('running');
    expect((await approve_wait(fixture)).event_jobs).toEqual([]);
  });

  it('spends one approval per held call, once each', async () => {
    const fixture = await wait_fixture();
    await approve_wait(fixture);
    await claim(fixture);

    expect(await consume(fixture, 'tcall_1')).not.toBeNull();
    expect(await consume(fixture, 'tcall_1')).toBeNull();
    expect(await consume(fixture, 'tcall_2')).not.toBeNull();
    expect(await consume(fixture, 'tcall_2')).toBeNull();
  });

  it('gives a wait a deadline, so a question nobody answers cannot hang forever', async () => {
    const fixture = await wait_fixture();
    expect(fixture.wait.event_job.awaits_until_time).toBeInstanceOf(Date);
    expect(fixture.wait.event_job.awaits_until_time?.getTime()).toBeGreaterThan(Date.now());
  });
});

async function wait_fixture() {
  const db = await create_test_database();
  const actor = await bootstrap_default_workspace(db);
  const session = await create_session(db, {
    workspace_id: actor.workspace_id,
    agent_id: actor.agent_id,
    actor_id: actor.user_id,
  });
  const tool_input = { amount: 240, order: { id: '4471', currency: 'USD' } };
  const input_sha256 = hash_tool_input_for_approval(tool_input);
  const second_input_sha256 = hash_tool_input_for_approval({ path: 'refunds.csv' });
  const queue_key = tool_policy_wait_subject({
    run_id: 'run_1',
    approval_call_hashes: [input_sha256, second_input_sha256],
  });
  const wait = await create_tool_policy_wait(db, {
    workspace_id: actor.workspace_id,
    queue_key,
    wait: {
      version: 2,
      kind: 'tool_policy_approval',
      session_id: session.session_id,
      source_run_id: 'run_1',
      calls: [
        { tool_call_id: 'tcall_1', input_sha256 },
        { tool_call_id: 'tcall_2', input_sha256: second_input_sha256 },
      ],
      requested_by: actor.user_id,
      eligible_user_ids: [actor.user_id],
    },
    actor_id: actor.user_id,
  });
  return { db, actor, session, queue_key, input_sha256, wait };
}

type WaitFixture = Awaited<ReturnType<typeof wait_fixture>>;

function approve_wait(fixture: WaitFixture) {
  return enqueue_event_jobs(fixture.db, {
    workspace_id: fixture.actor.workspace_id,
    source: 'policy',
    source_event_id: `${fixture.wait.event_job.job_id}:decision`,
    event_type: policy_decision_event_type,
    queue_key: fixture.queue_key,
    actor_key: fixture.actor.user_id,
    event_body: { job_id: fixture.wait.event_job.job_id, decision: 'approved' },
  });
}

function claim(fixture: WaitFixture) {
  return claim_ready_event_jobs_for_queue(fixture.db, {
    workspace_id: fixture.actor.workspace_id,
    queue_key: `session:${fixture.session.session_id}`,
    worker_id: 'worker_test',
  });
}

function consume(fixture: WaitFixture, tool_call_id: string) {
  return consume_tool_policy_approval(fixture.db, {
    workspace_id: fixture.actor.workspace_id,
    job_id: fixture.wait.event_job.job_id,
    tool_call_id,
  });
}
