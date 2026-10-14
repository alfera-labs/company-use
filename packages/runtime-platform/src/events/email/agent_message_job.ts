import type { Database, event_jobs, events } from '@coworker/core';
import { get_run, list_run_messages } from '@coworker/core/db/queries/sessions';
import type { EventJobHandlerResult } from '@coworker/jobs';
import { create_logger, format_error_message } from '@coworker/shared';
import { start_email_channel_turn } from '@runtime-platform/channels/email/channel_turn';
import {
  type EmailEventBody,
  email_event_body_schema,
  read_trusted_email_turn_context,
} from '@runtime-platform/channels/email/event_payloads';
import {
  build_inbound_email_message,
  is_auto_generated_email,
} from '@runtime-platform/channels/email/message_format';
import { fetch_received_email } from '@runtime-platform/channels/email/resend_api';
import { finalize_email_channel_turn } from '@runtime-platform/channels/email/turn_finalize';
import {
  hold_job_for_credit_top_up,
  job_is_still_waiting_for_credit,
} from '@runtime-platform/events/credit_top_up_hold';
import { read_agent_run_job } from '@runtime-platform/orchestrator/agent_run_job';

const log = create_logger('email_agent_message_job');

type EventRecord = typeof events.$inferSelect;
type EventJob = typeof event_jobs.$inferSelect;

type EmailAgentMessageJobInput = {
  db: Database;
  workspace_id: string;
  queue_key: string;
  event_jobs: EventJob[];
  events: EventRecord[];
  record_started_run_id?: (run_id: string) => Promise<void>;
  signal?: AbortSignal;
};

export async function run_email_agent_message_job(
  input: EmailAgentMessageJobInput,
): Promise<EventJobHandlerResult> {
  const recovered = await finish_job_for_terminal_run(input);
  if (recovered) return recovered;

  if (await job_is_still_waiting_for_credit(input.db, input)) {
    return hold_job_for_credit_top_up({
      event_jobs: input.event_jobs,
      code: 'out_of_credits',
      message: 'Workspace is out of credits.',
    });
  }

  const email_events = input.events
    .filter((event) => event.source === 'email' && event.event_status !== 'ignored')
    .sort((left, right) => left.created_time.getTime() - right.created_time.getTime())
    .flatMap((event) => {
      const body = email_event_body_schema.safeParse(event.event_body);
      return body.success ? [body.data] : [];
    });
  if (email_events.length === 0) return ignored_email_job_result('No email event was available.');

  const turns: EmailTurnOutcome[] = [];
  for (const email_event of email_events) {
    turns.push(await run_email_turn(input, email_event));
  }
  const failed_turn = turns.find((turn) => turn.status === 'failed');
  if (failed_turn) {
    return {
      job_status: 'failed',
      error_data: {
        code: failed_turn.code ?? 'email_turn_failed',
        message: failed_turn.message ?? 'An email turn failed.',
      },
    };
  }

  const unpaid_turn = turns.find(
    (turn) => turn.code === 'out_of_credits' || turn.code === 'card_required',
  );
  if (unpaid_turn?.code) {
    return hold_job_for_credit_top_up({
      event_jobs: input.event_jobs,
      code: unpaid_turn.code,
      message: unpaid_turn.message ?? 'Workspace has no credit to run this.',
    });
  }

  const last_run_id = turns
    .map((turn) => turn.run_id)
    .filter(Boolean)
    .at(-1);
  return {
    job_status: 'done',
    ...(last_run_id ? { run_id: last_run_id } : {}),
    result_data: { turns },
  };
}

type EmailTurnOutcome = {
  status: 'done' | 'failed';
  run_id?: string;
  session_id?: string;
  code?: string;
  message?: string;
};

async function run_email_turn(
  input: EmailAgentMessageJobInput,
  email_event: EmailEventBody,
): Promise<EmailTurnOutcome> {
  const received = await fetch_email(email_event.email_id);
  if (!received) {
    return {
      status: 'failed',
      code: 'email_fetch_failed',
      message: `Received email ${email_event.email_id} could not be fetched.`,
    };
  }
  if (is_auto_generated_email(received)) {
    return {
      status: 'done',
      code: 'auto_generated_email',
      message: 'Auto-generated mail skipped.',
    };
  }
  const message = build_inbound_email_message(received);
  if (!message) {
    return { status: 'done', code: 'sender_unparsable', message: 'Sender address unparsable.' };
  }

  const result = await start_email_channel_turn(input.db, {
    workspace_id: input.workspace_id,
    workspace_username: email_event.workspace_username,
    message,
    job: read_agent_run_job(input),
  });
  if (result.accepted) {
    return { status: 'done', run_id: result.run_id, session_id: result.session_id };
  }

  log.warn('email event was not dispatched', {
    code: result.code,
    message: result.message,
    workspace_id: input.workspace_id,
    queue_key: input.queue_key,
  });
  if (
    result.code === 'out_of_credits' ||
    result.code === 'card_required' ||
    result.code === 'agent_missing' ||
    result.code === 'approval_answered'
  ) {
    return { status: 'done', code: result.code, message: result.message };
  }
  return { status: 'failed', code: result.code, message: result.message };
}

async function finish_job_for_terminal_run(
  input: EmailAgentMessageJobInput,
): Promise<EventJobHandlerResult | null> {
  for (const run_id of read_event_job_run_ids(input.event_jobs)) {
    const run = await get_run(input.db, input.workspace_id, run_id);
    if (!run || !['completed', 'cancelled', 'failed'].includes(run.run_status)) continue;
    const turn_finalize = await finalize_recovered_email_turn(input, run);
    return {
      job_status: 'done',
      run_id,
      result_data: {
        recovered_started_run: true,
        run_status: run.run_status,
        ...(turn_finalize ? { turn_finalize } : {}),
      },
    };
  }
  return null;
}

async function finalize_recovered_email_turn(
  input: EmailAgentMessageJobInput,
  run: { run_id: string; run_status: string; error_message: string | null },
): Promise<string | null> {
  try {
    const run_messages = await list_run_messages(input.db, input.workspace_id, run.run_id);
    const session_id = run_messages.find((message) => message.session_id)?.session_id;
    const turn = run_messages
      .map((message) =>
        read_trusted_email_turn_context({
          source_type: 'email',
          ...(message.source_metadata
            ? { source_metadata: message.source_metadata as Record<string, unknown> }
            : {}),
        }),
      )
      .find((context) => context !== null);
    if (!turn || !session_id) return null;

    const result = await finalize_email_channel_turn(input.db, {
      workspace_id: input.workspace_id,
      session_id,
      run_id: run.run_id,
      run_status: run.run_status,
      run_error_message: run.error_message,
      turn,
      actor_id: 'system:email',
      finalized_by: 'email_agent_message_job_recovery',
    });
    return result.outcome;
  } catch (error) {
    log.error('finalizing the email turn for a recovered run failed', {
      workspace_id: input.workspace_id,
      run_id: run.run_id,
      error: format_error_message(error),
    });
    return null;
  }
}

async function fetch_email(email_id: string) {
  try {
    return await fetch_received_email(email_id);
  } catch (error) {
    log.error('fetching a received email failed', {
      email_id,
      error: format_error_message(error),
    });
    return null;
  }
}

function read_event_job_run_ids(jobs: EventJob[]) {
  return [
    ...new Set(
      jobs
        .map((job) => job.run_id)
        .filter((run_id): run_id is string => typeof run_id === 'string' && run_id.length > 0),
    ),
  ];
}

function ignored_email_job_result(message: string): EventJobHandlerResult {
  return {
    job_status: 'done',
    result_data: { dispatched: false, code: 'email_event_ignored', message },
  };
}
