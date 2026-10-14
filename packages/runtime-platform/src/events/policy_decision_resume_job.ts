import type { Database, event_jobs, events } from '@coworker/core';
import { type ChoicesWait, read_choices_wait } from '@coworker/core/access/choices_wait_schema';
import {
  read_approval_calls,
  tool_policy_approval_wait_schema,
  tool_policy_decision_schema,
} from '@coworker/core/access/tool_policy_approval_schema';
import { find_choices_answer } from '@coworker/core/db/queries/choices_answers';
import { release_waiting_run } from '@coworker/core/db/queries/run_suspension';
import {
  find_run_resumed_from_job,
  get_run,
  get_session,
  get_tool_call,
} from '@coworker/core/db/queries/sessions';
import type { EventJobHandlerResult } from '@coworker/jobs';
import { ConflictError } from '@coworker/shared';
import { hidden_session_resume_options } from '@runtime-platform/events/connection_resume_job';
import {
  continue_the_session,
  type PolicyDecisionResumeInput,
} from '@runtime-platform/events/policy_decision_continuation';
import {
  type DecidedCallOutcome,
  run_decided_tool_calls,
} from '@runtime-platform/events/policy_decision_replay';
import {
  closed_by_expiry,
  release_if_still_waiting,
} from '@runtime-platform/events/policy_decision_step_closing';
import {
  read_agent_run_job,
  start_agent_run_for_job,
} from '@runtime-platform/orchestrator/agent_run_job';
import { run_can_continue } from '@runtime-platform/orchestrator/run_resume';

const runs_that_could_still_act = new Set(['queued', 'starting', 'running']);

type EventJob = typeof event_jobs.$inferSelect;
type EventRecord = typeof events.$inferSelect;

export async function run_policy_decision_resume_job(
  input: PolicyDecisionResumeInput,
): Promise<EventJobHandlerResult> {
  const job = input.event_jobs[0];
  if (!job) return failed('approval_request_missing', 'The approval request is missing.');

  const existing_run = await find_run_resumed_from_job(input.db, {
    workspace_id: input.workspace_id,
    resumed_from_job_id: job.job_id,
  });
  if (existing_run && !this_job_continues(job, existing_run)) {
    return resumed(existing_run.run_id, existing_run.session_id, 'recovered', []);
  }

  const panel = read_choices_wait(job.metadata);
  if (panel) return catch_up_on_a_late_answer(input, job, panel);

  const answered = read_answered_step(job, input.events);
  if (!answered.step) return failed(answered.error.code, answered.error.message);

  const { wait, decision, decision_event } = answered.step;
  const session = await get_session(input.db, input.workspace_id, wait.session_id);
  if (!session) return failed('policy_session_missing', 'The policy session no longer exists.');

  const asking_run = await get_run(input.db, input.workspace_id, wait.source_run_id);
  if (asking_run && runs_that_could_still_act.has(asking_run.run_status)) {
    return come_back_shortly();
  }

  const calls = read_approval_calls(wait);
  if (!(await any_call_is_still_held(input.db, input.workspace_id, calls))) {
    await release_if_still_waiting(input, job, asking_run, answered.step);
    return answered_in_the_run_that_asked(wait.session_id);
  }

  const outcomes = await replay_decided_calls(input, job, answered.step, calls);
  const expired = closed_by_expiry(decision_event.actor_key, outcomes.length);
  if (expired) return expired;

  try {
    const run_id = await continue_the_session(input, {
      session,
      actor_id: decision_event.actor_key,
      job_id: job.job_id,
    });
    return resumed(run_id, session.session_id, decision, outcomes);
  } catch (error) {
    if (!is_session_still_busy(error)) throw error;
    return come_back_shortly();
  }
}

async function catch_up_on_a_late_answer(
  input: PolicyDecisionResumeInput,
  job: EventJob,
  wait: ChoicesWait,
): Promise<EventJobHandlerResult> {
  const answer = await find_choices_answer(input.db, {
    workspace_id: input.workspace_id,
    job_id: job.job_id,
    queue_key: job.awaits_queue_key ?? job.queue_key,
  });
  if (!answer) return { job_status: 'done', result_data: { nobody_answered: true } };

  if (job.metadata.answer_taken_by_the_run_that_asked) {
    return answered_in_the_run_that_asked(wait.session_id);
  }

  const asking_run = await get_run(input.db, input.workspace_id, wait.source_run_id);
  if (asking_run && runs_that_could_still_act.has(asking_run.run_status)) {
    return come_back_shortly();
  }

  const session = await get_session(input.db, input.workspace_id, wait.session_id);
  if (!session) return failed('policy_session_missing', 'The policy session no longer exists.');

  try {
    const result = await start_agent_run_for_job(
      input.db,
      {
        workspace_id: input.workspace_id,
        session_id: session.session_id,
        user_message: answer.answer_text,
        resumed_from_job_id: job.job_id,
        ...hidden_session_resume_options(session),
        actor_id: answer.answered_by,
      },
      read_agent_run_job(input),
    );
    return {
      job_status: 'done',
      run_id: result.run_id,
      result_data: { resumed: true, session_id: session.session_id, answered_late: true },
    };
  } catch (error) {
    if (!is_session_still_busy(error)) throw error;
    return come_back_shortly();
  }
}

async function replay_decided_calls(
  input: PolicyDecisionResumeInput,
  job: EventJob,
  step: AnsweredStep,
  calls: ReturnType<typeof read_approval_calls>,
) {
  const outcomes = await run_decided_tool_calls(input.db, {
    workspace_id: input.workspace_id,
    session_id: step.wait.session_id,
    run_id: step.wait.source_run_id,
    job_id: job.job_id,
    decision: step.decision,
    ...(step.reason === undefined ? {} : { reason: step.reason }),
    decision_event_id: step.decision_event.event_id,
    calls,
    actor_id: step.decision_event.actor_key,
  });
  await release_waiting_run(input.db, {
    workspace_id: input.workspace_id,
    run_id: step.wait.source_run_id,
    actor_id: step.decision_event.actor_key,
  });
  return outcomes;
}

function this_job_continues(job: EventJob, run: { run_id: string; run_status: string }) {
  return job.run_id === run.run_id && run_can_continue(run);
}

function read_answered_step(job: EventJob, events: EventRecord[]) {
  const parsed_wait = tool_policy_approval_wait_schema.safeParse(job.metadata.policy_approval);
  if (!parsed_wait.success) {
    return unreadable('approval_request_invalid', 'The approval request data is invalid.');
  }

  const decision_event = events.find((event) => event.event_type === 'person.decided');
  const parsed_decision = tool_policy_decision_schema.safeParse(decision_event?.event_body);
  if (!decision_event || !parsed_decision.success || parsed_decision.data.job_id !== job.job_id) {
    return unreadable('approval_answer_invalid', 'The approval answer is invalid.');
  }

  return {
    step: {
      wait: parsed_wait.data,
      decision: parsed_decision.data.decision,
      reason: parsed_decision.data.reason,
      decision_event,
    },
  };
}

type AnsweredStep = NonNullable<ReturnType<typeof read_answered_step>['step']>;

function unreadable(code: string, message: string) {
  return { step: null, error: { code, message } };
}

async function any_call_is_still_held(
  db: Database,
  workspace_id: string,
  calls: readonly { tool_call_id: string }[],
) {
  const rows = await Promise.all(
    calls.map((call) => get_tool_call(db, workspace_id, call.tool_call_id)),
  );
  return rows.some((row) => row?.tool_status === 'awaiting_approval');
}

function resumed(
  run_id: string,
  session_id: string,
  decision: string,
  outcomes: DecidedCallOutcome[],
): EventJobHandlerResult {
  return {
    job_status: 'done',
    run_id,
    result_data: { resumed: true, session_id, decision, calls_run: outcomes.length },
  };
}

function is_session_still_busy(error: unknown) {
  return error instanceof ConflictError || /active runtime run/u.test(String(error));
}

function come_back_shortly(): EventJobHandlerResult {
  return {
    job_status: 'done',
    retry_at: new Date(Date.now() + 2_000),
    retry_counts_as_attempt: false,
    result_data: { waiting_for_the_run_that_asked: true },
  };
}

function answered_in_the_run_that_asked(session_id: string): EventJobHandlerResult {
  return {
    job_status: 'done',
    result_data: { answered_in_the_run_that_asked: true, session_id },
  };
}

function failed(code: string, message: string): EventJobHandlerResult {
  return { job_status: 'failed', error_data: { code, message } };
}
