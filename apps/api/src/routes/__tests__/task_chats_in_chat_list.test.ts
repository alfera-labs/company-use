import { create_pi_engine } from '@agent-core/engines/pi';
import type { RuntimeAgentEngineEvent } from '@agent-core/runs';
import { create_app } from '@api/app';
import { create_agent_scheduled_task } from '@api/services/triggers/trigger_service';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { enqueue_event_jobs } from '@coworker/core/db/queries/events';
import { mark_run_waiting, record_run_wait } from '@coworker/core/db/queries/run_suspension';
import {
  create_run,
  create_run_messages,
  update_run_status,
} from '@coworker/core/db/queries/sessions';
import { run_queue_jobs } from '@coworker/jobs';
import { find_automation_fire_keys } from '@runtime-platform/automations/automation_subject';
import { find_event_job_handler } from '@runtime-platform/events/event_job_handler_registry';
import {
  prepare_trigger_fire_event,
  type TriggerFireDelivery,
  type TriggerRow,
} from '@runtime-platform/events/trigger_ingress';
import { configure_agent_engine } from '@runtime-platform/orchestrator/agent_engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ListedChat = {
  session_id: string;
  session_title: string;
  session_source: string;
  is_unread: boolean;
  newest_sequence: number;
  latest_run: { run_status: string } | null;
};

const json = { 'Content-Type': 'application/json' };
const task_actor = 'system:trigger';
const model = { reply: 'Nothing new.' };

let db: Database;
let app: ReturnType<typeof create_app>;
let identity: Awaited<ReturnType<typeof bootstrap_default_workspace>>;
let fire_count = 0;

async function* say_the_reply(): AsyncIterable<RuntimeAgentEngineEvent> {
  yield {
    type: 'message',
    message: { role: 'assistant', content: [{ type: 'text', text: model.reply }] },
  };
}

beforeEach(async () => {
  give_the_scripted_run_a_model_credential();
  db = await create_test_database();
  identity = await bootstrap_default_workspace(db);
  app = create_app(db);
  model.reply = 'Nothing new.';
  configure_agent_engine(() => ({
    engine_name: 'agent-core/pi/task-chat-test',
    run: say_the_reply,
  }));
});

afterEach(() => {
  configure_agent_engine(create_pi_engine);
  vi.unstubAllEnvs();
});

function give_the_scripted_run_a_model_credential() {
  vi.stubEnv('OPENAI_API_KEY', 'test_openai_key');
}

async function post(path: string, body: unknown) {
  const response = await app.request(path, {
    method: 'POST',
    headers: json,
    body: JSON.stringify(body),
  });
  return { status: response.status, data: (await response.json()).data };
}

async function list_chats(query = ''): Promise<ListedChat[]> {
  return (await (await app.request(`/v1/sessions${query}`)).json()).data;
}

async function find_chat(session_id: string) {
  return (await list_chats()).find((chat) => chat.session_id === session_id);
}

async function chats_titled(title: string) {
  return (await list_chats()).filter((chat) => chat.session_title === title);
}

async function run_the_fired_trigger(trigger: TriggerRow, delivery?: TriggerFireDelivery) {
  fire_count += 1;
  const options = { occurrence_key: `fire_${fire_count}`, ...(delivery ? { delivery } : {}) };
  const keys = await find_automation_fire_keys(db, trigger, options);
  const fire = prepare_trigger_fire_event(trigger, {
    ...options,
    ...(keys ? { queue_key: keys.queue_key } : {}),
  });
  if (!fire) throw new Error('the trigger starts no job');
  const queued = await enqueue_event_jobs(db, fire.event);
  await run_queue_jobs(
    db,
    { workspace_id: identity.workspace_id, queue_key: fire.queue_key },
    find_event_job_handler,
  );
  const [job] = queued.event_jobs;
  if (!job) throw new Error('the fire queued no job');
  return db.query.event_jobs.findFirst({
    where: (table, { eq }) => eq(table.job_id, job.job_id),
  });
}

async function create_scheduled_task(title: string) {
  return create_agent_scheduled_task(db, {
    workspace_id: identity.workspace_id,
    agent_id: identity.agent_id,
    task_name: title,
    instruction: 'Check the inbox for new invoices.',
    schedule_expression: '0 */4 * * *',
    actor_id: identity.user_id,
  });
}

async function run_scheduled_task(title: string) {
  const trigger = await create_scheduled_task(title);
  await run_the_fired_trigger(trigger);
  const [chat] = await chats_titled(title);
  if (!chat) throw new Error('the scheduled task run listed no chat');
  return { trigger, session_id: chat.session_id };
}

async function start_own_chat(title: string, project_id?: string) {
  const created = await post('/v1/sessions', {
    session_title: title,
    ...(project_id ? { project_id } : {}),
  });
  return created.data.session_id as string;
}

async function write_run(session_id: string, trigger_id: string | null, reply: string) {
  const run = await create_run(db, {
    workspace_id: identity.workspace_id,
    session_id,
    agent_id: identity.agent_id,
    trigger_type: trigger_id ? 'schedule' : 'user_message',
    trigger_id,
    actor_id: task_actor,
  });
  await create_run_messages(db, [
    {
      workspace_id: identity.workspace_id,
      session_id,
      run_id: run.run_id,
      message_role: 'assistant',
      message_content: { type: 'text', text: reply },
      source_type: 'runtime',
      actor_id: task_actor,
    },
  ]);
  return run.run_id;
}

const end_the_run_as: Record<string, (run_id: string) => Promise<unknown>> = {
  completed: (run_id) =>
    update_run_status(db, { run_id, run_status: 'completed', actor_id: task_actor }),
  failed: (run_id) => update_run_status(db, { run_id, run_status: 'failed', actor_id: task_actor }),
  waiting: async (run_id) => {
    const run = { workspace_id: identity.workspace_id, run_id, actor_id: task_actor };
    await update_run_status(db, { run_id, run_status: 'running', actor_id: task_actor });
    await record_run_wait(db, { ...run, job_id: 'job_approval' });
    await mark_run_waiting(db, run);
  },
};

describe('task chats in the chat list', () => {
  it('opens a task chat like any chat', async () => {
    const task = await run_scheduled_task('Check the inbox');

    const chat = await app.request(`/v1/sessions/${task.session_id}`);
    const messages = await app.request(`/v1/sessions/${task.session_id}/messages`);

    expect(chat.status).toBe(200);
    expect((await chat.json()).data.session_title).toBe('Check the inbox');
    expect(messages.status).toBe(200);
    expect(JSON.stringify(await messages.json())).toContain('Nothing new.');
  }, 60_000);

  it('filters task chats by project like any chat', async () => {
    const project = await post('/v1/projects', { project_name: 'Finance' });
    const project_id: string = project.data.project_id;
    await start_own_chat('Budget question', project_id);
    const task = await run_scheduled_task('Check the inbox');
    const titles = async () =>
      (await list_chats(`?project_id=${project_id}`)).map((chat) => chat.session_title).sort();

    expect(await titles()).toEqual(['Budget question']);

    const moved = await app.request(`/v1/sessions/${task.session_id}`, {
      method: 'PATCH',
      headers: json,
      body: JSON.stringify({ project_id }),
    });

    expect(moved.status).toBe(200);
    expect(await titles()).toEqual(['Budget question', 'Check the inbox']);
  }, 60_000);
});

describe('the unread dot on a task chat', () => {
  it('stays off after a finished run, a quiet one or one with a report', async () => {
    const task = await run_scheduled_task('Check the inbox');
    const after_the_quiet_run = await find_chat(task.session_id);
    model.reply = 'Three new invoices arrived. The total is 4,200.';
    await run_the_fired_trigger(task.trigger);
    const after_the_report = await find_chat(task.session_id);

    expect(after_the_quiet_run?.latest_run?.run_status).toBe('completed');
    expect(after_the_quiet_run?.is_unread).toBe(false);
    expect(after_the_report?.newest_sequence).toBeGreaterThan(
      after_the_quiet_run?.newest_sequence ?? 0,
    );
    expect(after_the_report?.is_unread).toBe(false);
  }, 60_000);

  it.each([
    'waiting',
    'failed',
  ])('goes on when the latest run is %s, and off once the chat is read', async (run_status) => {
    const task = await run_scheduled_task('Check the inbox');
    const run_id = await write_run(task.session_id, task.trigger.trigger_id, 'I need you here.');
    await end_the_run_as[run_status]?.(run_id);

    const chat = await find_chat(task.session_id);
    expect(chat?.latest_run?.run_status).toBe(run_status);
    expect(chat?.is_unread).toBe(true);

    await post(`/v1/sessions/${task.session_id}/read`, {
      last_read_sequence: chat?.newest_sequence,
    });
    expect((await find_chat(task.session_id))?.is_unread).toBe(false);
  }, 60_000);

  it('keeps the old rule for a chat a person started: a finished run with a new message is unread', async () => {
    const own_chat = await start_own_chat('Plan the offsite');
    const run_id = await write_run(own_chat, null, 'Here is the plan.');
    await end_the_run_as.completed?.(run_id);

    const chat = await find_chat(own_chat);

    expect(chat?.latest_run?.run_status).toBe('completed');
    expect(chat?.is_unread).toBe(true);
  });
});

describe('a task chat the person deleted', () => {
  it('lets the next scheduled run start a fresh chat and finish', async () => {
    const task = await run_scheduled_task('Check the inbox');
    const deleted = await app.request(`/v1/sessions/${task.session_id}`, { method: 'DELETE' });

    const job = await run_the_fired_trigger(task.trigger);

    const chats = await chats_titled('Check the inbox');
    expect(deleted.status).toBe(200);
    expect(job?.job_status).toBe('done');
    expect(chats).toHaveLength(1);
    expect(chats[0]?.session_id).not.toBe(task.session_id);
    expect(chats[0]?.latest_run?.run_status).toBe('completed');
  }, 60_000);
});
