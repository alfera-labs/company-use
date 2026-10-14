import { get_session_for_user } from '@coworker/core/db/queries/sessions';
import { workspace_member_is_active } from '@coworker/core/db/queries/workspace_membership';
import { type QueueRef, read_queue_worker_key } from '@coworker/jobs';
import { AppError, session_queue_key } from '@coworker/shared';
import { list_session_run_chat_events_after } from '@runtime-platform/chat_stream/live_run_events';
import {
  type RunStreamTicketClaims,
  verify_run_stream_ticket,
} from '@runtime-platform/chat_stream/run_stream_ticket';
import {
  cancel_run_in_this_process,
  verify_queue_worker_control,
} from '@runtime-platform/orchestrator/queue_worker_control';
import type { QueueWorkerConnState } from '@worker/queue_worker_live_connections';
import type { WorkerServices } from '@worker/worker_services';
import { UserError } from 'rivetkit/errors';
import { z } from 'zod';

const connect_params_schema = z.union([
  z.object({ ticket: z.string().min(1) }).strict(),
  z.object({ api_signature: z.string().min(1) }).strict(),
]);
const events_after_schema = z
  .object({
    ticket: z.string().min(1),
    run_id: z.string().min(1),
    after_sequence: z.number().int().nonnegative(),
  })
  .strict();
const cancel_run_schema = z
  .object({ run_id: z.string().min(1), api_signature: z.string().min(1) })
  .strict();

export function read_queue_ref(services: WorkerServices, key: string[]): QueueRef {
  try {
    return read_queue_worker_key(key, services.rivet_key_scope);
  } catch (error) {
    throw to_user_error(error);
  }
}

export async function create_connection_state(
  services: WorkerServices,
  queue: QueueRef,
  params: unknown,
): Promise<QueueWorkerConnState> {
  const caller = parse_or_refuse(connect_params_schema, params);
  if ('api_signature' in caller) {
    await as_user_error(async () =>
      verify_queue_worker_control(caller.api_signature, scoped(services, queue), services.now()),
    );
    return { caller: 'server' };
  }
  const claims = verify_ticket_for_queue(services, queue, caller.ticket);
  await require_session_reader(services, claims);
  return { caller: 'browser', user_id: claims.user_id, exp: claims.exp };
}

export async function read_events_after(services: WorkerServices, queue: QueueRef, body: unknown) {
  const input = parse_or_refuse(events_after_schema, body);
  const claims = verify_ticket_for_queue(services, queue, input.ticket);
  await require_session_reader(services, claims);
  return as_user_error(() =>
    list_session_run_chat_events_after(services.db, {
      workspace_id: claims.workspace_id,
      session_id: claims.session_id,
      run_id: input.run_id,
      after_sequence: input.after_sequence,
    }),
  );
}

export async function cancel_run_here(services: WorkerServices, queue: QueueRef, body: unknown) {
  const input = parse_or_refuse(cancel_run_schema, body);
  await as_user_error(async () =>
    verify_queue_worker_control(
      input.api_signature,
      { ...scoped(services, queue), run_id: input.run_id },
      services.now(),
    ),
  );
  const target = { workspace_id: queue.workspace_id, run_id: input.run_id };
  const result = await cancel_run_in_this_process(services.db, target);
  services.log.info(`cancel_run ${input.run_id} in ${queue.queue_key}: ${JSON.stringify(result)}`);
  return result;
}

function verify_ticket_for_queue(services: WorkerServices, queue: QueueRef, ticket: string) {
  const session_id = queue.queue_key.slice(session_queue_key('').length);
  if (!session_id || session_queue_key(session_id) !== queue.queue_key) {
    throw refused('stream_access_refused', 'This queue has no live stream.');
  }
  try {
    return verify_run_stream_ticket(
      ticket,
      { key_scope: services.rivet_key_scope, workspace_id: queue.workspace_id, session_id },
      services.now(),
    );
  } catch (error) {
    throw to_user_error(error);
  }
}

async function require_session_reader(services: WorkerServices, claims: RunStreamTicketClaims) {
  const reader = { workspace_id: claims.workspace_id, user_id: claims.user_id };
  const is_member = await workspace_member_is_active(services.db, reader);
  if (!is_member) throw refused('stream_access_refused', 'You are not a member of this workspace.');
  const session = await get_session_for_user(services.db, {
    ...reader,
    session_id: claims.session_id,
  });
  if (!session) throw refused('stream_access_refused', 'You cannot read this chat.');
}

function scoped(services: WorkerServices, queue: QueueRef) {
  return { key_scope: services.rivet_key_scope, ...queue };
}

function parse_or_refuse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw refused('invalid_request', 'The request is not valid.');
  return parsed.data;
}

async function as_user_error<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw to_user_error(error);
  }
}

function to_user_error(error: unknown) {
  if (error instanceof AppError) return refused(error.code, error.message);
  return error;
}

function refused(code: string, message: string) {
  return new UserError(message, { code });
}
