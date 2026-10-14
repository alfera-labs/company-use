import {
  get_queue_worker_client,
  type QueueWorkerClient,
} from '@api/services/events/rivet_queue_worker_client';
import { env } from '@coworker/config';
import type { QueueRef } from '@coworker/jobs';
import { AppError, create_logger, session_queue_key } from '@coworker/shared';
import { issue_run_stream_ticket } from '@runtime-platform/chat_stream/run_stream_ticket';

const log = create_logger('session_stream_ticket');

export async function issue_session_stream_ticket(input: {
  workspace_id: string;
  session_id: string;
  user_id: string;
}) {
  const client = get_queue_worker_client();
  if (!client || !env.RIVET_PUBLIC_ENDPOINT) {
    throw new AppError('live_stream_unavailable', 'Live streaming is not available here.', 404);
  }
  const queue = {
    workspace_id: input.workspace_id,
    queue_key: session_queue_key(input.session_id),
  };
  const actor_key = await create_session_queue_worker(client, queue);
  const { ticket, expires_time } = issue_run_stream_ticket({
    key_scope: client.key_scope,
    ...input,
  });
  return {
    rivet_endpoint: env.RIVET_PUBLIC_ENDPOINT,
    rivet_namespace: env.RIVET_NAMESPACE ?? null,
    rivet_token: read_browser_safe_connection_token(env.RIVET_PUBLIC_ENDPOINT),
    actor_key,
    ticket,
    expires_time,
  };
}

async function create_session_queue_worker(client: QueueWorkerClient, queue: QueueRef) {
  try {
    return await client.create_queue_worker(queue);
  } catch (error) {
    log.warn('the queue worker for a live stream could not be created', {
      ...queue,
      key_scope: client.key_scope,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new AppError(
      'live_stream_unavailable',
      'Live streaming is not available right now.',
      503,
    );
  }
}

export function read_browser_safe_connection_token(public_endpoint: string) {
  const token = env.RIVET_CONNECTION_TOKEN;
  if (!token) return null;
  if (!token.startsWith('ck_') && !is_loopback_endpoint(public_endpoint)) {
    throw new AppError(
      'live_stream_unavailable',
      'Live streaming is not available here: the connection token is not a `ck_` token.',
      404,
    );
  }
  return token;
}

function is_loopback_endpoint(endpoint: string) {
  const host = URL.parse(endpoint)?.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}
