import type { PublicSessionUsage } from '@api/services/sessions_api/public_session';
import { send_api_session_events } from '@api/services/sessions_api/session_event_writes';
import {
  create_api_session,
  type PublicTextBlock,
} from '@api/services/sessions_api/session_service';
import {
  max_session_wait_seconds,
  wait_for_idle_api_session,
} from '@api/services/sessions_api/session_wait';
import type { Database } from '@coworker/core/db/connection';
import type { ApiKey } from '@coworker/core/db/queries/api_keys';
import { AppError, id_prefixes, is_id } from '@coworker/shared';

const compat_turn_wait_seconds = max_session_wait_seconds;

const response_id_prefix = 'resp';

function session_id_to_response_id(session_id: string): string {
  return `${response_id_prefix}_${session_id}`;
}

export function response_id_to_session_id(response_id: string): string {
  const session_id = response_id.startsWith(`${response_id_prefix}_`)
    ? response_id.slice(response_id_prefix.length + 1)
    : response_id;
  if (!is_id(session_id, id_prefixes.session)) {
    throw new AppError(
      'validation_error',
      'That previous_response_id is not a known response',
      400,
    );
  }
  return session_id;
}

export type CompatTurnResult = {
  session_id: string;
  response_id: string;
  text: string;
  usage: PublicSessionUsage;
};

export async function run_compat_turn(
  db: Database,
  input: {
    api_key: ApiKey;
    content: PublicTextBlock[];
    resume_session_id?: string | undefined;
    idempotency_key?: string | undefined;
    signal: AbortSignal;
  },
): Promise<CompatTurnResult> {
  const session_id = input.resume_session_id
    ? await queue_turn_on_existing_session(
        db,
        input.api_key,
        input.resume_session_id,
        input.content,
      )
    : await open_session_with_turn(db, input.api_key, input.content, input.idempotency_key);

  const settled = await wait_for_idle_api_session(db, input.api_key, {
    session_id,
    timeout_seconds: compat_turn_wait_seconds,
    signal: input.signal,
  });
  if ('wait_timed_out' in settled) {
    throw new AppError('run_timeout', 'The agent is still working; retry the request.', 503, {
      session_id,
    });
  }
  return {
    session_id,
    response_id: session_id_to_response_id(session_id),
    text: settled.last_agent_message ?? '',
    usage: settled.usage,
  };
}

async function open_session_with_turn(
  db: Database,
  api_key: ApiKey,
  content: PublicTextBlock[],
  idempotency_key: string | undefined,
): Promise<string> {
  const session = await create_api_session(
    db,
    {
      api_key,
      initial_events: [{ type: 'user.message', content }],
      metadata: {},
    },
    idempotency_key,
  );
  return session.session_id;
}

async function queue_turn_on_existing_session(
  db: Database,
  api_key: ApiKey,
  session_id: string,
  content: PublicTextBlock[],
): Promise<string> {
  await send_api_session_events(db, api_key, session_id, [{ type: 'user.message', content }]);
  return session_id;
}
