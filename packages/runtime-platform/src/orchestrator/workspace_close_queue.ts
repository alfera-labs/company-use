import { create_logger } from '@coworker/shared';

const log = create_logger('workspace_close_queue');
const close_work_by_mount_key = new Map<string, Promise<void>>();

export function wait_for_workspace_close_work(workspace_mount_key: string): Promise<void> {
  return close_work_by_mount_key.get(workspace_mount_key) ?? Promise.resolve();
}

export function queue_workspace_close_work(
  workspace_mount_key: string,
  work: () => Promise<void>,
): Promise<void> {
  const queued = wait_for_workspace_close_work(workspace_mount_key)
    .then(work)
    .catch((error) =>
      log.warn('Workspace close work failed after the run finished.', {
        workspace_mount_key,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  close_work_by_mount_key.set(workspace_mount_key, queued);
  void queued.then(() => {
    if (close_work_by_mount_key.get(workspace_mount_key) === queued) {
      close_work_by_mount_key.delete(workspace_mount_key);
    }
  });
  return queued;
}

export function wait_for_all_workspace_close_work(): Promise<unknown> {
  return Promise.all(close_work_by_mount_key.values());
}
