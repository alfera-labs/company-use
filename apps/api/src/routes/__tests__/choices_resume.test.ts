import { create_app } from '@api/app';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { find_choices_answer } from '@coworker/core/db/queries/choices_answers';
import {
  choices_wait_subject,
  create_choices_wait,
  get_tool_policy_wait,
  record_choices_answer_taken_by_the_run,
  withdraw_run_tool_policy_waits,
} from '@coworker/core/db/queries/event_waits';
import {
  create_run,
  create_session,
  get_session,
  update_run_status,
} from '@coworker/core/db/queries/sessions';
import { run_queue_jobs } from '@coworker/jobs';
import { find_event_job_handler } from '@runtime-platform/events/event_job_handler_registry';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const orchestrator = vi.hoisted(() => ({ start_run: vi.fn() }));

vi.mock('@runtime-platform/orchestrator/runtime_orchestrator', async (import_original) => ({
  ...(await import_original<object>()),
  start_agent_run: orchestrator.start_run,
}));

beforeEach(() => {
  orchestrator.start_run.mockReset();
  orchestrator.start_run.mockImplementation(
    async (
      db: Parameters<typeof create_run>[0],
      input: {
        workspace_id: string;
        session_id: string;
        actor_id: string;
        resumed_from_job_id?: string;
      },
      options?: {
        on_stream_event?: (event: {
          type: 'run_created';
          run: { run_id: string };
        }) => Promise<void>;
      },
    ) => {
      const session = await get_session(db, input.workspace_id, input.session_id);
      if (!session) throw new Error('The continuation session is missing.');
      const run = await create_run(db, {
        workspace_id: input.workspace_id,
        session_id: input.session_id,
        agent_id: session.agent_id,
        trigger_type: 'api',
        resumed_from_job_id: input.resumed_from_job_id ?? null,
        actor_id: input.actor_id,
      });
      await options?.on_stream_event?.({ type: 'run_created', run });
      return { run_id: run.run_id };
    },
  );
});

async function a_chat_parked_on_a_panel(asked_of?: {
  eligible_user_ids: string[];
  tool_call_id?: string;
}) {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  const session = await create_session(db, {
    workspace_id: bootstrap.workspace_id,
    agent_id: bootstrap.agent_id,
    actor_id: bootstrap.user_id,
  });
  const run = await create_run(db, {
    workspace_id: bootstrap.workspace_id,
    session_id: session.session_id,
    agent_id: bootstrap.agent_id,
    trigger_type: 'user_message',
    actor_id: bootstrap.user_id,
  });
  const queue_key = choices_wait_subject({ run_id: run.run_id });
  const { event_job } = await create_choices_wait(db, {
    workspace_id: bootstrap.workspace_id,
    queue_key,
    actor_id: bootstrap.user_id,
    wait: {
      version: 1,
      kind: 'choices_wait',
      session_id: session.session_id,
      source_run_id: run.run_id,
      asked_by: bootstrap.user_id,
      eligible_user_ids: asked_of?.eligible_user_ids ?? [bootstrap.user_id],
      ...(asked_of?.tool_call_id ? { tool_call_id: asked_of.tool_call_id } : {}),
    },
  });
  return {
    db,
    bootstrap,
    session,
    run,
    queue_key,
    job_id: event_job.job_id,
    app: create_app(db),
  };
}

function answer(app: ReturnType<typeof create_app>, job_id: string, body: unknown) {
  return app.request(`/v1/choices/${job_id}/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('GET /v1/choices/open', () => {
  it('gives the same wait back on every fresh page load', async () => {
    const { app, session, job_id } = await a_chat_parked_on_a_panel();

    for (const _reload of [1, 2, 3]) {
      const response = await app.request(`/v1/choices/open?session_id=${session.session_id}`);
      expect(response.status).toBe(200);
      expect((await response.json()).data).toEqual({ job_id, session_id: session.session_id });
    }
  });

  it('names the call the panel is drawn from', async () => {
    const { app, session } = await a_chat_parked_on_a_panel({
      eligible_user_ids: [],
      tool_call_id: 'tcall_the_ask',
    });

    const response = await app.request(`/v1/choices/open?session_id=${session.session_id}`);
    expect((await response.json()).data.tool_call_id).toBe('tcall_the_ask');
  });

  it('offers a panel that names nobody to whoever is in the workspace', async () => {
    const { app, session, job_id } = await a_chat_parked_on_a_panel({ eligible_user_ids: [] });

    const response = await app.request(`/v1/choices/open?session_id=${session.session_id}`);
    expect((await response.json()).data).toMatchObject({ job_id });
    expect((await answer(app, job_id, { answer_text: 'Every Monday' })).status).toBe(200);
  });

  it('offers a panel asked of somebody else to an admin, exactly as the answer allows', async () => {
    const { app, session, job_id } = await a_chat_parked_on_a_panel({
      eligible_user_ids: ['user_somebody_else'],
    });

    const response = await app.request(`/v1/choices/open?session_id=${session.session_id}`);
    expect((await response.json()).data).toMatchObject({ job_id });
    expect((await answer(app, job_id, { answer_text: 'Every Monday' })).status).toBe(200);
  });

  it('says null for a chat that is not parked on anything', async () => {
    const { app, db, bootstrap } = await a_chat_parked_on_a_panel();
    const other = await create_session(db, {
      workspace_id: bootstrap.workspace_id,
      agent_id: bootstrap.agent_id,
      actor_id: bootstrap.user_id,
    });

    const response = await app.request(`/v1/choices/open?session_id=${other.session_id}`);
    expect((await response.json()).data).toBeNull();
  });

  it('stops offering the panel once it is answered', async () => {
    const { app, session, job_id } = await a_chat_parked_on_a_panel();

    expect((await answer(app, job_id, { answer_text: 'Every Monday' })).status).toBe(200);

    const response = await app.request(`/v1/choices/open?session_id=${session.session_id}`);
    expect((await response.json()).data).toBeNull();
  });

  it('withdraws the panel when the run is stopped', async () => {
    const { app, db, bootstrap, run, session } = await a_chat_parked_on_a_panel();

    await withdraw_run_tool_policy_waits(db, {
      workspace_id: bootstrap.workspace_id,
      run_id: run.run_id,
      actor_id: bootstrap.user_id,
    });

    const response = await app.request(`/v1/choices/open?session_id=${session.session_id}`);
    expect((await response.json()).data).toBeNull();
  });
});

describe('POST /v1/choices/:job_id/answer', () => {
  it('records the answer where the parked run reads it', async () => {
    const { app, db, bootstrap, job_id, queue_key } = await a_chat_parked_on_a_panel();

    expect((await answer(app, job_id, { answer_text: '  Every Monday  ' })).status).toBe(200);

    const found = await find_choices_answer(db, {
      workspace_id: bootstrap.workspace_id,
      job_id,
      queue_key,
    });
    expect(found?.answer_text).toBe('Every Monday');
    expect(found?.answered_by).toBe(bootstrap.user_id);
  });

  it('refuses an empty answer instead of waking the run with nothing', async () => {
    const { app, db, bootstrap, job_id, queue_key } = await a_chat_parked_on_a_panel();

    for (const empty of ['', '   ', '\n\t ']) {
      expect((await answer(app, job_id, { answer_text: empty })).status).toBe(422);
    }

    expect(
      await find_choices_answer(db, { workspace_id: bootstrap.workspace_id, job_id, queue_key }),
    ).toBeNull();
  });

  it('refuses a body that is not an answer at all', async () => {
    const { app, job_id } = await a_chat_parked_on_a_panel();

    expect((await answer(app, job_id, {})).status).toBe(422);
    expect((await answer(app, job_id, { answer_text: 42 })).status).toBe(422);
    expect((await answer(app, job_id, { answer_text: 'ok', extra: true })).status).toBe(422);
  });

  it('answers once, and says so plainly the second time', async () => {
    const { app, job_id } = await a_chat_parked_on_a_panel();

    expect((await answer(app, job_id, { answer_text: 'Weekly' })).status).toBe(200);

    const second = await answer(app, job_id, { answer_text: 'Daily' });
    expect(second.status).toBe(422);
    expect((await second.json()).error.message).toContain('already been answered');
  });

  it('is a 404 for a panel that never existed', async () => {
    const { app } = await a_chat_parked_on_a_panel();
    expect((await answer(app, 'ejob_nope', { answer_text: 'hello' })).status).toBe(404);
  });
});

describe('an answer that arrives after the run that asked has gone', () => {
  it('carries on the chat from what the person said', async () => {
    const parked = await a_chat_parked_on_a_panel();
    await the_asking_run_died(parked);

    expect((await answer(parked.app, parked.job_id, { answer_text: 'Every Monday' })).status).toBe(
      200,
    );
    await the_queue_catches_up(parked);

    expect(orchestrator.start_run).toHaveBeenCalledTimes(1);
    expect(orchestrator.start_run.mock.calls[0]?.[1]).toMatchObject({
      session_id: parked.session.session_id,
      user_message: 'Every Monday',
      resumed_from_job_id: parked.job_id,
    });
    expect(await read_job_status(parked)).toBe('done');
  }, 20_000);

  it('starts no second run when the queue comes back to the same answer', async () => {
    const parked = await a_chat_parked_on_a_panel();
    await the_asking_run_died(parked);
    await answer(parked.app, parked.job_id, { answer_text: 'Every Monday' });
    await the_queue_catches_up(parked);

    await the_queue_catches_up(parked);

    expect(orchestrator.start_run).toHaveBeenCalledTimes(1);
  }, 20_000);

  it('says nothing when the run that asked took the answer itself', async () => {
    const parked = await a_chat_parked_on_a_panel();
    await the_asking_run_died(parked);
    await the_asking_run_took_the_answer(parked);

    await answer(parked.app, parked.job_id, { answer_text: 'Every Monday' });
    await the_queue_catches_up(parked);

    expect(orchestrator.start_run).not.toHaveBeenCalled();
  }, 20_000);
});

type ParkedPanel = Awaited<ReturnType<typeof a_chat_parked_on_a_panel>>;

function the_asking_run_died(parked: ParkedPanel) {
  return update_run_status(parked.db, {
    run_id: parked.run.run_id,
    run_status: 'failed',
    actor_id: parked.bootstrap.user_id,
  });
}

function the_asking_run_took_the_answer(parked: ParkedPanel) {
  return record_choices_answer_taken_by_the_run(parked.db, {
    workspace_id: parked.bootstrap.workspace_id,
    job_id: parked.job_id,
    actor_id: parked.bootstrap.user_id,
  });
}

function the_queue_catches_up(parked: ParkedPanel) {
  return run_queue_jobs(
    parked.db,
    {
      workspace_id: parked.bootstrap.workspace_id,
      queue_key: `session:${parked.session.session_id}`,
    },
    find_event_job_handler,
  );
}

async function read_job_status(parked: ParkedPanel) {
  const job = await get_tool_policy_wait(parked.db, {
    workspace_id: parked.bootstrap.workspace_id,
    job_id: parked.job_id,
  });
  return job?.job_status;
}
