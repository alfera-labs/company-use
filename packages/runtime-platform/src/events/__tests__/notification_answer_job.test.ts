import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_session } from '@coworker/core/db/queries/sessions';
import { events } from '@coworker/core/db/schema';
import { ConflictError } from '@coworker/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const start_agent_run = vi.fn(async (_db: unknown, _input: Record<string, unknown>) => ({
  run_id: 'run_from_the_answer',
}));
vi.mock('@runtime-platform/orchestrator/runtime_orchestrator', () => ({ start_agent_run }));

const { run_notification_answer_job } = await import(
  '@runtime-platform/events/notification_answer_job'
);

describe('run_notification_answer_job', () => {
  beforeEach(() => start_agent_run.mockClear());

  it('says the person\'s "Yes, go ahead." in the conversation that asked', async () => {
    const fixture = await create_fixture();

    const result = await run_notification_answer_job({
      db: fixture.db,
      workspace_id: fixture.workspace_id,
      events: [fixture.event],
    });

    expect(result).toMatchObject({ job_status: 'done', run_id: 'run_from_the_answer' });
    expect(start_agent_run).toHaveBeenCalledTimes(1);
    expect(start_agent_run.mock.calls[0]?.[1]).toMatchObject({
      workspace_id: fixture.workspace_id,
      session_id: fixture.session_id,
      user_message: 'Yes, go ahead.',
      actor_id: fixture.user_id,
    });
  });

  it('lets a busy-session conflict escape so the runner retries', async () => {
    const fixture = await create_fixture();
    start_agent_run.mockRejectedValueOnce(
      new ConflictError('Session already has an active runtime run'),
    );

    await expect(
      run_notification_answer_job({
        db: fixture.db,
        workspace_id: fixture.workspace_id,
        events: [fixture.event],
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

async function create_fixture() {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  const session = await create_session(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    actor_id: bootstrap.user_id,
  });
  const [event] = await db
    .insert(events)
    .values({
      event_id: 'evt_answer_test',
      workspace_id: bootstrap.workspace_id,
      source: 'notification',
      source_event_id: 'evt_notification:answer',
      event_type: 'notification.answered',
      queue_key: `notification_answer:${session.session_id}`,
      actor_key: bootstrap.user_id,
      event_body: {
        notification_event_id: 'evt_notification',
        session_id: session.session_id,
        answered_by: bootstrap.user_id,
        answer: 'yes',
      },
      created_by: bootstrap.user_id,
      last_updated_by: bootstrap.user_id,
    })
    .returning();
  if (!event) throw new Error('failed to seed the answer event');
  return {
    db,
    event,
    workspace_id: bootstrap.workspace_id,
    user_id: bootstrap.user_id,
    session_id: session.session_id,
  };
}
