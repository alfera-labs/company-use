import type { Database, event_jobs, events } from '@coworker/core';
import type { get_session } from '@coworker/core/db/queries/sessions';
import { start_slack_channel_turn } from '@runtime-platform/channels/slack/channel_turn';
import { read_slack_resume_target } from '@runtime-platform/channels/slack/slack_session_target';
import { find_active_slack_connection_for_workspace_team } from '@runtime-platform/channels/slack/workspace_connection';
import { hidden_session_resume_options } from '@runtime-platform/events/connection_resume_job';
import {
  read_agent_run_job,
  start_agent_run_for_job,
} from '@runtime-platform/orchestrator/agent_run_job';

export type PolicyDecisionResumeInput = {
  db: Database;
  workspace_id: string;
  event_jobs: (typeof event_jobs.$inferSelect)[];
  events: (typeof events.$inferSelect)[];
  record_started_run_id?: (run_id: string) => Promise<void>;
  signal?: AbortSignal;
};

type ContinuationInput = {
  session: NonNullable<Awaited<ReturnType<typeof get_session>>>;
  actor_id: string;
  job_id: string;
};

const continuation_note = 'Picking the approved step back up.';

export async function continue_the_session(
  input: PolicyDecisionResumeInput,
  continuation: ContinuationInput,
) {
  const slack = read_slack_resume_target(continuation.session);
  if (!slack) return continue_chat(input, continuation);

  const connection = await find_active_slack_connection_for_workspace_team(input.db, {
    workspace_id: input.workspace_id,
    team_id: slack.team_id,
  });
  if (!connection) throw new Error('The policy resume Slack connection is missing.');

  const result = await start_slack_channel_turn(input.db, {
    workspace_id: input.workspace_id,
    agent_id: continuation.session.agent_id,
    actor_id: continuation.actor_id,
    connection_id: connection.connection_id,
    message: {
      team_id: slack.team_id,
      channel_id: slack.channel_id,
      channel_type: slack.channel_type,
      event_ts: slack_timestamp(new Date()),
      thread_ts: slack.thread_ts,
      user_id: slack.user_id,
      ...(slack.user_profile ? { user_profile: slack.user_profile } : {}),
      text: continuation_note,
      raw_text: continuation_note,
    },
    known_thread_reply: true,
    run_options: { resumed_from_job_id: continuation.job_id },
    job: read_agent_run_job(input),
  });
  if (!result.accepted) throw new Error(`The policy resume was rejected: ${result.code}`);
  return result.run_id;
}

async function continue_chat(input: PolicyDecisionResumeInput, continuation: ContinuationInput) {
  const result = await start_agent_run_for_job(
    input.db,
    {
      workspace_id: input.workspace_id,
      session_id: continuation.session.session_id,
      continues_session: true,
      resumed_from_job_id: continuation.job_id,
      ...hidden_session_resume_options(continuation.session),
      actor_id: continuation.actor_id,
    },
    read_agent_run_job(input),
  );
  return result.run_id;
}

function slack_timestamp(date: Date) {
  return `${Math.floor(date.getTime() / 1000)}.${String((date.getTime() % 1000) * 1000).padStart(6, '0')}`;
}
