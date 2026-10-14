import { create_pi_engine } from '@agent-core/engines/pi';
import type { RuntimeAgentEngineEvent } from '@agent-core/runs';
import { create_app } from '@api/app';
import { create_workspace_scout_trigger } from '@api/services/scout/scout_provisioning';
import { create_workspace_system_automation_triggers } from '@api/services/triggers/system_automation_schedules';
import { create_agent_scheduled_task } from '@api/services/triggers/trigger_service';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import { list_automation_triggers } from '@coworker/core/db/queries/automation_triggers';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { enqueue_event_jobs } from '@coworker/core/db/queries/events';
import {
  create_run,
  create_run_messages,
  find_or_create_session_for_external_thread,
} from '@coworker/core/db/queries/sessions';
import { run_queue_jobs } from '@coworker/jobs';
import { scout_session_kind, scout_session_thread_prefix } from '@coworker/shared';
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

async function create_automation(title: string) {
  const created = await post('/v1/automations', {
    automation_name: title,
    instruction: 'Draft a reply to the ticket.',
    run_policy: { subject_from: 'thread_id', when_a_run_is_already_going: 'wait_for_it_to_finish' },
    triggers: [{ kind: 'webhook' }],
  });
  const [trigger] = await list_automation_triggers(db, {
    workspace_id: identity.workspace_id,
    automation_id: created.data.automation.automation_id,
  });
  if (!trigger) throw new Error('the automation has no trigger');
  return trigger;
}

function event_about(thread_id: string): TriggerFireDelivery {
  return {
    provider: 'webhook',
    trigger_slug: 'ticket_received',
    received_time: new Date().toISOString(),
    data: { thread_id, text: 'Can I get a copy of my invoice?' },
  };
}

async function start_own_chat(title: string, project_id?: string) {
  const created = await post('/v1/sessions', {
    session_title: title,
    ...(project_id ? { project_id } : {}),
  });
  return created.data.session_id as string;
}

async function open_trigger_chat(input: {
  thread_key: string;
  title: string;
  source_metadata: Record<string, unknown>;
}) {
  const session = await find_or_create_session_for_external_thread(db, {
    workspace_id: identity.workspace_id,
    agent_id: identity.agent_id,
    session_source: 'trigger',
    external_thread_key: input.thread_key,
    session_title: input.title,
    source_metadata: input.source_metadata,
    actor_id: task_actor,
  });
  return session.session_id;
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

async function start_system_chats() {
  const identity_input = { workspace_id: identity.workspace_id, actor_id: identity.user_id };
  const scout = await create_workspace_scout_trigger(db, identity_input);
  const [tick] = await create_workspace_system_automation_triggers(db, identity_input);
  if (!tick) throw new Error('the workspace has no system schedule');
  const scout_chat = await open_trigger_chat({
    thread_key: `${scout_session_thread_prefix}:${scout.trigger_id}`,
    title: scout.trigger_name,
    source_metadata: {
      trigger_id: scout.trigger_id,
      kind: scout_session_kind,
      runtime_response_is_user_visible: false,
    },
  });
  const scout_task_chat = await open_trigger_chat({
    thread_key: `trigger:${scout.trigger_id}`,
    title: scout.trigger_name,
    source_metadata: { trigger_id: scout.trigger_id },
  });
  const tick_chat = await open_trigger_chat({
    thread_key: `trigger:${tick.trigger_id}`,
    title: tick.trigger_name,
    source_metadata: { trigger_id: tick.trigger_id },
  });
  const sweep_chat = await open_trigger_chat({
    thread_key: `calendar_offset_sweep:${identity.workspace_id}`,
    title: 'Calendar offset sweep',
    source_metadata: { kind: 'calendar_offset_sweep', runtime_response_is_user_visible: false },
  });
  await write_run(scout_task_chat, scout.trigger_id, 'Looked around.');
  await write_run(tick_chat, tick.trigger_id, 'Ticked.');
  return [scout_chat, scout_task_chat, tick_chat, sweep_chat];
}

describe('task chats in the chat list', () => {
  it('lists the chats a scheduled task and an automation started, in time order with the rest', async () => {
    await start_own_chat('Plan the offsite');
    await run_scheduled_task('Check the inbox');
    await start_own_chat('Review the contract');
    await run_the_fired_trigger(await create_automation('Answer new tickets'), event_about('t1'));

    const chats = await list_chats();

    expect(chats.map((chat) => [chat.session_title, chat.session_source])).toEqual([
      ['Answer new tickets', 'trigger'],
      ['Review the contract', 'dashboard'],
      ['Check the inbox', 'trigger'],
      ['Plan the offsite', 'dashboard'],
    ]);
  }, 60_000);

  it('keeps every chat the platform started for itself out of the list', async () => {
    const own_chat = await start_own_chat('Plan the offsite');
    const task = await run_scheduled_task('Check the inbox');
    const system_chats = await start_system_chats();

    const listed = (await list_chats()).map((chat) => chat.session_id);

    expect(listed.sort()).toEqual([own_chat, task.session_id].sort());
    expect(listed.filter((session_id) => system_chats.includes(session_id))).toEqual([]);
  }, 60_000);

  it('filters task chats by project and keeps the scout and system chats out', async () => {
    const project = await post('/v1/projects', { project_name: 'Finance' });
    const project_id: string = project.data.project_id;
    await start_own_chat('Budget question', project_id);
    const task = await run_scheduled_task('Check the inbox');
    await start_system_chats();
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

describe('a task chat the person deleted', () => {
  it('lets the next event on the same subject start a fresh automation chat and finish', async () => {
    const trigger = await create_automation('Answer new tickets');
    await run_the_fired_trigger(trigger, event_about('t1'));
    await run_the_fired_trigger(trigger, event_about('t1'));
    const grouped = await chats_titled('Answer new tickets');
    const first_chat = grouped[0]?.session_id ?? '';
    await app.request(`/v1/sessions/${first_chat}`, { method: 'DELETE' });

    const job = await run_the_fired_trigger(trigger, event_about('t1'));

    const chats = await chats_titled('Answer new tickets');
    expect(grouped).toHaveLength(1);
    expect(job?.job_status).toBe('done');
    expect(job?.result_data).toMatchObject({ ran: true, subject_is_known: false });
    expect(chats).toHaveLength(1);
    expect(chats[0]?.session_id).not.toBe(first_chat);
    expect(chats[0]?.latest_run?.run_status).toBe('completed');
  }, 60_000);
});
