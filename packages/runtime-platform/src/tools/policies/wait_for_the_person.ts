import { env } from '@coworker/config';
import type { Database } from '@coworker/core';
import {
  type ApprovalAnswer,
  approval_wake_channel,
  find_approval_answer,
} from '@coworker/core/db/queries/approval_answers';
import { watch_for_wake } from '@coworker/core/db/wake_channel';

const default_window_ms = 5 * 60 * 1000;

const backstop_interval_ms = 5_000;

export function approval_wait_window_ms() {
  const configured = env.APPROVAL_WAIT_WINDOW_MS?.trim();
  if (!configured) return default_window_ms;
  const window_ms = Number(configured);
  return Number.isFinite(window_ms) && window_ms >= 0 ? window_ms : default_window_ms;
}

export function approval_wait_window_ms_for_session(session_source: string | undefined) {
  return session_source === 'api' ? 0 : approval_wait_window_ms();
}

export type PersonAnswered<TAnswer = ApprovalAnswer> =
  | { answered: true; answer: TAnswer }
  | { answered: false; reason: 'nobody_answered_in_time' | 'the_run_was_cancelled' };

export type ReadTheAnswer<TAnswer> = (
  db: Database,
  input: { workspace_id: string; job_id: string; queue_key: string },
) => Promise<TAnswer | null>;

export async function wait_for_the_person<TAnswer = ApprovalAnswer>(
  db: Database,
  input: {
    workspace_id: string;
    job_id: string;
    queue_key: string;
    actor_id: string;
    signal?: AbortSignal | undefined;
    window_ms?: number;
    read_answer?: ReadTheAnswer<TAnswer>;
    wake_channel?: string;
  },
): Promise<PersonAnswered<TAnswer>> {
  const read_answer = (input.read_answer ??
    (find_approval_answer as unknown as ReadTheAnswer<TAnswer>)) as ReadTheAnswer<TAnswer>;
  const deadline = Date.now() + (input.window_ms ?? approval_wait_window_ms());
  const watch = watch_for_wake(input.wake_channel ?? approval_wake_channel, input.job_id);

  try {
    while (Date.now() < deadline) {
      if (input.signal?.aborted) return give_up(db, input, 'the_run_was_cancelled', read_answer);

      const answer = await read_answer(db, input);
      if (answer) return { answered: true, answer };

      await watch.wait_for_a_wake(
        Math.min(backstop_interval_ms, Math.max(deadline - Date.now(), 0)),
        input.signal,
      );
    }

    return give_up(db, input, 'nobody_answered_in_time', read_answer);
  } finally {
    watch.stop();
  }
}

type GaveUpBecause = 'nobody_answered_in_time' | 'the_run_was_cancelled';

async function give_up<TAnswer>(
  db: Database,
  input: { workspace_id: string; job_id: string; queue_key: string; actor_id: string },
  reason: GaveUpBecause,
  read_answer: ReadTheAnswer<TAnswer>,
): Promise<PersonAnswered<TAnswer>> {
  const answer = await read_answer(db, input);
  if (answer) return { answered: true, answer };
  return { answered: false, reason };
}
