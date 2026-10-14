import type { agents, sessions } from '@coworker/core';
import type { SessionTokenUsage } from '@coworker/core/db/queries/api_sessions';
import { z } from 'zod';

type SessionRow = typeof sessions.$inferSelect;
type AgentRow = typeof agents.$inferSelect;

type PublicSessionStatus = 'running' | 'idle' | 'terminated';

export type PublicSessionUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
};

export function public_session_usage(totals: SessionTokenUsage | undefined): PublicSessionUsage {
  return {
    input_tokens: totals?.input_tokens ?? 0,
    output_tokens: totals?.output_tokens ?? 0,
    cache_read_input_tokens: totals?.cache_read_tokens ?? 0,
    cache_creation_input_tokens: totals?.cache_write_tokens ?? 0,
  };
}

export type PublicSession = {
  session_id: string;
  status: PublicSessionStatus;
  agent: { agent_id: string; slug: string; name: string };
  title: string | null;
  // The project the session is filed in; null is "no project", readable by the whole workspace.
  project_id: string | null;
  metadata: Record<string, string>;
  usage: PublicSessionUsage;
  created_time: Date;
  last_activity_time: Date;
  archived_time: Date | null;
};

const caller_metadata_key = 'caller_metadata';

const source_metadata_schema = z
  .object({
    [caller_metadata_key]: z.record(z.string(), z.string()).optional(),
    request_fingerprint: z.string().optional(),
  })
  .loose();

export function api_session_source_metadata(input: {
  api_key_id: string;
  request_fingerprint: string;
  caller_metadata: Record<string, string>;
}): Record<string, unknown> {
  return {
    api_key_id: input.api_key_id,
    sessions_api: true,
    request_fingerprint: input.request_fingerprint,
    [caller_metadata_key]: input.caller_metadata,
  };
}

export function read_api_session_metadata(session: SessionRow) {
  return source_metadata_schema.safeParse(session.source_metadata).data ?? {};
}

export function public_session(input: {
  session: SessionRow;
  agent: AgentRow | undefined;
  usage: PublicSessionUsage;
  has_pending_job: boolean;
  is_waiting_on_approval: boolean;
}): PublicSession {
  const { session, agent } = input;
  return {
    session_id: session.session_id,
    status: public_session_status(session, input.has_pending_job, input.is_waiting_on_approval),
    agent: {
      agent_id: session.agent_id,
      slug: agent?.agent_slug ?? '',
      name: agent?.agent_name ?? '',
    },
    title: session.session_title,
    project_id: session.project_id,
    metadata: read_api_session_metadata(session)[caller_metadata_key] ?? {},
    usage: input.usage,
    created_time: session.created_time,
    last_activity_time: session.last_message_time ?? session.last_updated_time,
    archived_time: archived_time(session),
  };
}

function public_session_status(
  session: SessionRow,
  has_pending_job: boolean,
  is_waiting_on_approval: boolean,
): PublicSessionStatus {
  if (session_is_archived(session)) return 'terminated';
  const lock_holds =
    Boolean(session.locked_by_run_id) && (session.lock_expires_time?.getTime() ?? 0) > Date.now();
  return lock_holds || has_pending_job || is_waiting_on_approval ? 'running' : 'idle';
}

export function session_is_archived(session: SessionRow) {
  return session.session_status === 'deleted';
}

// No archived_time column — archiving is the last thing that writes an archived session,
// so its last_updated_time IS that moment. Add a real column if archived sessions ever get edited.
function archived_time(session: SessionRow) {
  return session_is_archived(session) ? session.last_updated_time : null;
}
