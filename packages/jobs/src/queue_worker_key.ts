import { AppError } from '@coworker/shared';

export type QueueRef = { workspace_id: string; queue_key: string };
export type QueueWorkerKey = [key_scope: string, workspace_id: string, queue_key: string];

export function build_queue_worker_key(key_scope: string, queue: QueueRef): QueueWorkerKey {
  return [key_scope, queue.workspace_id, queue.queue_key];
}

export function read_queue_worker_key(key: readonly string[], own_key_scope: string): QueueRef {
  const [key_scope, workspace_id, queue_key, ...rest] = key;
  if (!key_scope || !workspace_id || !queue_key || rest.length > 0) {
    throw key_refused(
      `A queue worker key is [key_scope, workspace_id, queue_key], got ${JSON.stringify(key)}.`,
    );
  }
  if (key_scope !== own_key_scope) {
    throw key_refused(`This queue worker serves the key scope ${own_key_scope}, not ${key_scope}.`);
  }
  return { workspace_id, queue_key };
}

function key_refused(message: string) {
  return new AppError('queue_worker_key_refused', message, 403);
}
