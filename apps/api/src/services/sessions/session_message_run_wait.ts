import { randomUUID } from 'node:crypto';
import { check_again, repeat_until_done } from '@api/services/sessions/repeat_until_done';
import { read_session_message_outcome } from '@api/services/sessions/session_message_outcome';
import { send_session_message } from '@api/services/sessions/session_message_queue';
import type { SessionMessageRequest } from '@api/services/sessions/session_message_request';
import type { Database } from '@coworker/core';
import { find_session_message_job } from '@coworker/core/db/queries/session_message_queue';
import { get_run } from '@coworker/core/db/queries/sessions';
import { AppError, NotFoundError } from '@coworker/shared';

const check_interval_ms = 500;
const longest_wait_ms = 60 * 60 * 1000;

export async function send_session_message_and_wait_for_run(
  db: Database,
  input: {
    workspace_id: string;
    session_id: string;
    user_id: string;
    body: SessionMessageRequest;
    signal?: AbortSignal;
  },
) {
  const { job } = await send_session_message(db, {
    ...input,
    client_message_id: `api:${randomUUID()}`,
  });
  const run_id = await wait_for_message_run_to_finish(db, { ...input, job_id: job.job_id });
  const run = await get_run(db, input.workspace_id, run_id);
  if (!run) throw new NotFoundError('Run');
  return run;
}

async function wait_for_message_run_to_finish(
  db: Database,
  input: { workspace_id: string; session_id: string; job_id: string; signal?: AbortSignal },
) {
  const deadline = Date.now() + longest_wait_ms;
  const run_id = await repeat_until_done<string | null>(async () => {
    if (Date.now() >= deadline || input.signal?.aborted) return { done: true, value: null };
    const job = await find_session_message_job(db, input);
    if (!job) throw new NotFoundError('Queued message');
    const outcome = read_session_message_outcome(job);
    if (outcome.kind === 'ran') return { done: true, value: outcome.run_id };
    if (outcome.kind === 'refused') throw outcome.error;
    return check_again;
  }, check_interval_ms);
  if (run_id !== null) return run_id;
  throw new AppError(
    'message_still_waiting',
    'The message is still waiting for its turn. Its run will appear in the chat when it starts.',
    503,
    { job_id: input.job_id },
  );
}
