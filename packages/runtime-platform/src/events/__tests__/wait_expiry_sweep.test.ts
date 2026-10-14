import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import {
  choices_wait_subject,
  create_choices_wait,
  create_tool_policy_wait,
} from '@coworker/core/db/queries/event_waits';
import { list_expired_waits } from '@coworker/core/db/queries/run_suspension';
import { create_run, create_session } from '@coworker/core/db/queries/sessions';
import { event_jobs } from '@coworker/core/db/schema';
import { expire_overdue_waits } from '@runtime-platform/events/wait_expiry_sweep';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

describe('a question nobody answered', () => {
  it('is left alone while its deadline has not passed', async () => {
    const fixture = await create_wait();

    expect(await list_expired_waits(fixture.db)).toEqual([]);
    expect(await expire_overdue_waits(fixture.db)).toEqual({ found: 0, refused: 0 });
    expect(await read_job_status(fixture)).toBe('waiting');
  });

  it('is refused once the deadline passes, so the run stops hanging', async () => {
    const fixture = await create_wait();
    await set_deadline_in_the_past(fixture);

    expect(await expire_overdue_waits(fixture.db)).toEqual({ found: 1, refused: 1 });

    expect(await read_job_status(fixture)).not.toBe('waiting');
    expect(await list_expired_waits(fixture.db)).toEqual([]);
  });

  it('closes a panel nobody answered, not only an approval', async () => {
    const fixture = await create_wait();
    const panel = await a_panel_nobody_answered(fixture);
    await set_deadline_in_the_past(fixture, panel.job_id);

    expect(await expire_overdue_waits(fixture.db)).toEqual({ found: 1, refused: 1 });

    expect(await read_job_status(fixture, panel.job_id)).not.toBe('waiting');
    expect(await list_expired_waits(fixture.db)).toEqual([]);
  }, 20_000);

  it('looks at the oldest deadline first', async () => {
    const fixture = await create_wait();
    const panel = await a_panel_nobody_answered(fixture);
    await set_deadline_in_the_past(fixture, fixture.job_id, 60_000);
    await set_deadline_in_the_past(fixture, panel.job_id, 600_000);

    const expired = await list_expired_waits(fixture.db);
    expect(expired.map((wait) => wait.job_id)).toEqual([panel.job_id, fixture.job_id]);
  });
});

type WaitFixture = Awaited<ReturnType<typeof create_wait>>;

async function create_wait() {
  const db = await create_test_database();
  const actor = await bootstrap_default_workspace(db);
  const session = await create_session(db, {
    workspace_id: actor.workspace_id,
    agent_id: actor.agent_id,
    actor_id: actor.user_id,
  });
  const created = await create_tool_policy_wait(db, {
    workspace_id: actor.workspace_id,
    queue_key: 'wait:tool_policy:expiry_test',
    wait: {
      version: 2,
      kind: 'tool_policy_approval',
      session_id: session.session_id,
      source_run_id: 'run_expiry_test',
      calls: [{ tool_call_id: 'tcall_expiry_test', input_sha256: 'a'.repeat(64) }],
      requested_by: actor.user_id,
      eligible_user_ids: [actor.user_id],
    },
    actor_id: actor.user_id,
  });
  return { db, actor, session, job_id: created.event_job.job_id };
}

async function a_panel_nobody_answered(fixture: WaitFixture) {
  const run = await create_run(fixture.db, {
    workspace_id: fixture.actor.workspace_id,
    session_id: fixture.session.session_id,
    agent_id: fixture.actor.agent_id,
    trigger_type: 'user_message',
    actor_id: fixture.actor.user_id,
  });
  const { event_job } = await create_choices_wait(fixture.db, {
    workspace_id: fixture.actor.workspace_id,
    queue_key: choices_wait_subject({ run_id: run.run_id }),
    actor_id: fixture.actor.user_id,
    wait: {
      version: 1,
      kind: 'choices_wait',
      session_id: fixture.session.session_id,
      source_run_id: run.run_id,
      asked_by: fixture.actor.user_id,
      eligible_user_ids: [fixture.actor.user_id],
    },
  });
  return { job_id: event_job.job_id };
}

function set_deadline_in_the_past(fixture: WaitFixture, job_id?: string, overdue_by_ms = 60_000) {
  return fixture.db
    .update(event_jobs)
    .set({ awaits_until_time: new Date(Date.now() - overdue_by_ms) })
    .where(eq(event_jobs.job_id, job_id ?? fixture.job_id));
}

async function read_job_status(fixture: WaitFixture, job_id?: string) {
  const job = await fixture.db.query.event_jobs.findFirst({
    where: eq(event_jobs.job_id, job_id ?? fixture.job_id),
  });
  return job?.job_status;
}
