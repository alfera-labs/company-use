import type { Database } from '@coworker/core/db/connection';
import { create_logger } from '@coworker/shared';

const log = create_logger('scout');

export type ScoutObserver = (db: Database, workspace_id: string) => Promise<void>;

const scout_observers: ScoutObserver[] = [];

export function register_scout_observer(observer: ScoutObserver): void {
  if (!scout_observers.includes(observer)) scout_observers.push(observer);
}

export async function notify_scout_observers(db: Database, workspace_id: string): Promise<void> {
  for (const observe of scout_observers) {
    await observe(db, workspace_id).catch((error: unknown) => log.error('observer failed', error));
  }
}
