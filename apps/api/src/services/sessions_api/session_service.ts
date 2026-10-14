import { createHash } from 'node:crypto';
import {
  api_session_source_metadata,
  type PublicSession,
  read_api_session_metadata,
} from '@api/services/sessions_api/public_session';
import { get_api_session } from '@api/services/sessions_api/session_reads';
import type { Database } from '@coworker/core/db/connection';
import type { ApiKey } from '@coworker/core/db/queries/api_keys';
import { find_api_session_by_thread_key } from '@coworker/core/db/queries/api_sessions';
import {
  find_agent_by_slug,
  find_or_create_session_for_external_thread,
} from '@coworker/core/db/queries/sessions';
import { find_team_room_of_maker } from '@coworker/core/db/queries/team_room_of_maker';
import { queue_and_run_event_jobs } from '@coworker/jobs';
import {
  AppError,
  create_id,
  id_prefixes,
  NotFoundError,
  session_queue_key,
} from '@coworker/shared';
import {
  type ApiSessionTurnJobBody,
  api_session_event_source,
  api_session_turn_event_type,
  api_session_turn_job_handler,
} from '@runtime-platform/events/api_session_turn_job';
import { find_event_job_handler } from '@runtime-platform/events/event_job_handler_registry';

const session_turn_payload_version = 1;
const default_agent_slug = 'main';

export type PublicTextBlock = { type: 'text'; text: string };

export type CreateSessionRequest = {
  api_key: ApiKey;
  agent_slug?: string | undefined;
  title?: string | undefined;
  initial_events: { type: 'user.message'; content: PublicTextBlock[] }[];
  metadata: Record<string, string>;
};

export async function create_api_session(
  db: Database,
  request: CreateSessionRequest,
  idempotency_key: string | undefined,
): Promise<PublicSession> {
  const agent_slug = request.agent_slug ?? default_agent_slug;
  const agent = await find_agent_by_slug(db, request.api_key.workspace_id, agent_slug);
  if (!agent) throw new NotFoundError(`Agent '${agent_slug}'`);

  const request_fingerprint = calculate_create_request_fingerprint(request, agent_slug);
  const replayed = idempotency_key
    ? await replay_created_session(db, request.api_key, idempotency_key, request_fingerprint)
    : null;
  if (replayed) return replayed;

  const session = await find_or_create_session_for_external_thread(db, {
    workspace_id: request.api_key.workspace_id,
    agent_id: agent.agent_id,
    session_source: 'api',
    external_thread_key: idempotency_thread_key(request.api_key, idempotency_key),
    ...(request.title ? { session_title: request.title } : {}),
    source_metadata: api_session_source_metadata({
      api_key_id: request.api_key.api_key_id,
      request_fingerprint,
      caller_metadata: request.metadata,
    }),
    actor_id: request.api_key.api_key_id,
    ...(await find_team_room_of_maker(db, {
      workspace_id: request.api_key.workspace_id,
      maker_id: request.api_key.api_key_id,
    })),
  });
  if (idempotency_key) assert_same_create_request(session, request_fingerprint);

  if (request.initial_events.length > 0) {
    await queue_session_turn(db, {
      api_key: request.api_key,
      session_id: session.session_id,
      user_content: request.initial_events.flatMap((event) => event.content),
      source_event_id: `${session.session_id}:initial_events`,
    });
  }
  return get_api_session(db, request.api_key, session.session_id);
}

export async function queue_session_turn(
  db: Database,
  input: {
    api_key: ApiKey;
    session_id: string;
    user_content: PublicTextBlock[];
    source_event_id: string;
  },
): Promise<void> {
  const event_body: ApiSessionTurnJobBody = {
    session_turn_payload_version,
    session_id: input.session_id,
    user_content: input.user_content,
    api_key_id: input.api_key.api_key_id,
  };
  await queue_and_run_event_jobs(
    db,
    {
      workspace_id: input.api_key.workspace_id,
      source: api_session_event_source,
      source_event_id: input.source_event_id,
      event_type: api_session_turn_event_type,
      queue_key: session_queue_key(input.session_id),
      actor_key: input.api_key.api_key_id,
      event_body,
      event_jobs: [{ job_handler: api_session_turn_job_handler }],
    },
    find_event_job_handler,
  );
}

function idempotency_thread_key(api_key: ApiKey, idempotency_key: string | undefined) {
  if (!idempotency_key) return create_id(id_prefixes.session);
  return `${api_key.api_key_id}:${idempotency_key}`;
}

async function replay_created_session(
  db: Database,
  api_key: ApiKey,
  idempotency_key: string,
  request_fingerprint: string,
): Promise<PublicSession | null> {
  const existing = await find_api_session_by_thread_key(db, {
    workspace_id: api_key.workspace_id,
    external_thread_key: idempotency_thread_key(api_key, idempotency_key),
  });
  if (!existing) return null;
  assert_same_create_request(existing, request_fingerprint);
  return get_api_session(db, api_key, existing.session_id);
}

function assert_same_create_request(
  session: Parameters<typeof read_api_session_metadata>[0],
  request_fingerprint: string,
) {
  if (read_api_session_metadata(session).request_fingerprint === request_fingerprint) return;
  throw new AppError(
    'idempotency_key_reused',
    'This Idempotency-Key was already used with different parameters; use a new key.',
    409,
  );
}

function calculate_create_request_fingerprint(
  request: CreateSessionRequest,
  agent_slug: string,
): string {
  const parameters = [agent_slug, request.title ?? null, request.initial_events, request.metadata];
  return createHash('sha256').update(JSON.stringify(parameters), 'utf8').digest('hex');
}
