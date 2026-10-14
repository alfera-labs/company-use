import {
  assert_api_key_still_live,
  open_long_poll_slot,
  sleep_unless_aborted,
} from '@api/lib/api_key_long_poll';
import {
  read_session_held_tool_calls,
  type SessionHeldToolCall,
} from '@api/services/sessions_api/session_held_tool_calls';
import {
  get_api_session_snapshot,
  type SessionSnapshot,
} from '@api/services/sessions_api/session_reads';
import type { Database } from '@coworker/core/db/connection';
import type { ApiKey } from '@coworker/core/db/queries/api_keys';

// Polling, not LISTEN/NOTIFY — the same trade the answer wait makes, for the same reason.
const session_poll_interval_ms = 500;

export const default_session_wait_seconds = 60;
export const max_session_wait_seconds = 120;

type SessionWaitTimedOut = { wait_timed_out: true; session_id: string };

export type SettledSession = SessionSnapshot & { held_tool_calls: SessionHeldToolCall[] };

export type SessionWaitResult = SettledSession | SessionWaitTimedOut;

export async function wait_for_idle_api_session(
  db: Database,
  api_key: ApiKey,
  input: {
    session_id: string;
    timeout_seconds: number;
    signal: AbortSignal;
    returns_when_it_holds_a_tool_call?: boolean;
  },
): Promise<SessionWaitResult> {
  const timeout_seconds = Math.min(input.timeout_seconds, max_session_wait_seconds);
  const deadline = Date.now() + timeout_seconds * 1000;
  const release_slot = open_long_poll_slot(api_key.api_key_id);
  try {
    while (true) {
      const session = await read_settled_session(db, api_key, input);
      if (session.status !== 'running' || session.held_tool_calls.length > 0) return session;

      const remaining_ms = deadline - Date.now();
      if (remaining_ms <= 0 || input.signal.aborted) return timed_out(input.session_id);
      await sleep_unless_aborted(input.signal, Math.min(session_poll_interval_ms, remaining_ms));
      if (input.signal.aborted) return timed_out(input.session_id);
      await assert_api_key_still_live(db, api_key);
    }
  } finally {
    release_slot();
  }
}

export async function read_settled_session(
  db: Database,
  api_key: ApiKey,
  input: { session_id: string; returns_when_it_holds_a_tool_call?: boolean },
): Promise<SettledSession> {
  const [snapshot, held_tool_calls] = await Promise.all([
    get_api_session_snapshot(db, api_key, input.session_id),
    input.returns_when_it_holds_a_tool_call
      ? read_session_held_tool_calls(db, api_key, input.session_id)
      : [],
  ]);
  return { ...snapshot, held_tool_calls };
}

function timed_out(session_id: string): SessionWaitTimedOut {
  return { wait_timed_out: true, session_id };
}
