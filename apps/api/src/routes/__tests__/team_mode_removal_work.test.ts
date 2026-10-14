import {
  as_person,
  call,
  db,
  invite_and_join,
  main_agent_id,
  sign_the_owner_in,
  use_a_fresh_team_install,
} from '@api/routes/__tests__/team_mode_install';
import { create_api_session } from '@api/services/sessions_api/session_service';
import { create_api_key } from '@coworker/core/db/queries/api_keys';
import { enqueue_event_jobs } from '@coworker/core/db/queries/event_enqueue_statement';
import { create_run } from '@coworker/core/db/queries/sessions';
import { event_jobs, runs } from '@coworker/core/db/schema';
import { session_agent_message_job_handler, session_queue_key } from '@coworker/shared';
import { run_session_agent_message_job } from '@runtime-platform/events/session_agent_message_job';
import { session_message_event_source } from '@runtime-platform/events/session_agent_message_payload';
import { message_sender_has_left_the_team } from '@runtime-platform/events/trigger_member_gate';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

use_a_fresh_team_install();

type Team = Awaited<ReturnType<typeof owner_and_a_member>>;

async function owner_and_a_member() {
  const owner = await sign_the_owner_in();
  const member = await invite_and_join(owner.user_id, 'Lin', 'member');
  const workspace = await call('GET', '/v1/workspace', as_person(owner.user_id));
  return {
    owner,
    member,
    workspace_id: String(workspace.data.workspace_id),
    agent_id: await main_agent_id(as_person(owner.user_id)),
  };
}

const remove = (team: Team) =>
  call('DELETE', `/v1/team/members/${team.member.user_id}`, as_person(team.owner.user_id));

async function chat_of(user_id: string) {
  const chat = await call('POST', '/v1/sessions', as_person(user_id), {});
  return String(chat.data.session_id);
}

async function waiting_message_of(team: Team, user_id: string, session_id: string) {
  const queued = await enqueue_event_jobs(db, {
    workspace_id: team.workspace_id,
    source: session_message_event_source,
    source_event_id: `${session_id}:${user_id}:message`,
    event_type: 'message',
    queue_key: session_queue_key(session_id),
    actor_key: user_id,
    event_body: {
      version: 1,
      session_id,
      actor_user_id: user_id,
      message: 'Do the long job.',
      client_message_id: `test:${user_id}`,
    },
    event_jobs: [{ job_handler: session_agent_message_job_handler }],
  });
  return { event: queued.event, job_id: queued.event_jobs[0]?.job_id ?? '' };
}

async function status_of_job(job_id: string) {
  const [job] = await db.select().from(event_jobs).where(eq(event_jobs.job_id, job_id));
  return job?.job_status;
}

describe('what removal stops for a person who is out', () => {
  it('stops the run going in a chat that was started with a key the person made', async () => {
    const team = await owner_and_a_member();
    const { api_key } = await create_api_key(db, {
      workspace_id: team.workspace_id,
      key_name: 'A key',
      scopes: ['sessions.write'],
      key_audience: 'internal',
      environment_label: 'live',
      actor_id: team.member.user_id,
    });
    const chat = await create_api_session(
      db,
      { api_key, initial_events: [], metadata: {} },
      undefined,
    );
    const run = await create_run(db, {
      workspace_id: team.workspace_id,
      session_id: chat.session_id,
      agent_id: team.agent_id,
      trigger_type: 'api',
      actor_id: api_key.api_key_id,
    });

    const removed = await remove(team);

    expect(removed.data.runs_stopped).toBe(1);
    const [stopped] = await db.select().from(runs).where(eq(runs.run_id, run.run_id));
    expect(stopped?.run_status).toBe('cancelled');
  });

  it('takes back the messages of that person that wait for a run, and nobody else messages', async () => {
    const team = await owner_and_a_member();
    const of_member = await waiting_message_of(
      team,
      team.member.user_id,
      await chat_of(team.member.user_id),
    );
    const of_owner = await waiting_message_of(
      team,
      team.owner.user_id,
      await chat_of(team.owner.user_id),
    );
    expect(await status_of_job(of_member.job_id)).toBe('queued');

    const removed = await remove(team);

    expect(removed.data.waiting_messages_cleared).toBe(1);
    expect(await status_of_job(of_member.job_id)).toBe('cancelled');
    expect(await status_of_job(of_owner.job_id)).toBe('queued');
  });

  it('starts no run for a message whose sender is not an active member any more', async () => {
    const team = await owner_and_a_member();
    const session_id = await chat_of(team.member.user_id);
    const { event } = await waiting_message_of(team, team.member.user_id, session_id);
    const sender = { workspace_id: team.workspace_id, sender_id: team.member.user_id };
    expect(await message_sender_has_left_the_team(db, sender)).toBe(false);
    await remove(team);

    const outcome = await run_session_agent_message_job({
      db,
      workspace_id: team.workspace_id,
      event_jobs: [],
      events: [event],
    });

    expect(outcome).toMatchObject({
      job_status: 'done',
      result_data: { ran: false, code: 'sender_not_on_the_team' },
    });
    expect(await db.select().from(runs).where(eq(runs.session_id, session_id))).toEqual([]);
    expect(await message_sender_has_left_the_team(db, sender)).toBe(true);
    vi.stubEnv('COWORKER_AUTH_MODE', '');
    expect(await message_sender_has_left_the_team(db, sender)).toBe(false);
  });

  it('counts a key as out when it is revoked or when the person who made it is out', async () => {
    const team = await owner_and_a_member();
    const { api_key } = await create_api_key(db, {
      workspace_id: team.workspace_id,
      key_name: 'A key',
      scopes: ['sessions.write'],
      key_audience: 'internal',
      environment_label: 'live',
      actor_id: team.member.user_id,
    });
    const sender = { workspace_id: team.workspace_id, sender_id: api_key.api_key_id };
    expect(await message_sender_has_left_the_team(db, sender)).toBe(false);

    await remove(team);

    expect(await message_sender_has_left_the_team(db, sender)).toBe(true);
  });
});
