import type { Database } from '@coworker/core';
import { get_run_cancel_intent } from '@coworker/core/db/queries/sessions';
import { create_logger } from '@coworker/shared';

const log = create_logger('runtime_orchestrator');

export function settle_write(write: Promise<unknown>): Promise<{ error: unknown } | undefined> {
  return write.then(
    () => undefined,
    (error: unknown) => ({ error }),
  );
}

export async function read_cancel_intent_before_start(
  db: Database,
  input: { workspace_id: string; run_id: string },
) {
  try {
    return await get_run_cancel_intent(db, input.workspace_id, input.run_id);
  } catch (error) {
    log.warn('the cancel check before the first model call failed', { error });
    return undefined;
  }
}
