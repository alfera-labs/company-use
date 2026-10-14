import type { Database } from '@coworker/core';
import { create_logger } from '@coworker/shared';
import { minute_maintenance_steps } from '@runtime-platform/events/minute_maintenance_steps';

const log = create_logger('minute_maintenance');

type MinuteMaintenanceStep = keyof typeof minute_maintenance_steps;
type MinuteMaintenanceResult = Record<MinuteMaintenanceStep, unknown>;

async function run_maintenance_step(
  db: Database,
  step: string,
  run_step: (db: Database) => Promise<unknown>,
) {
  try {
    return [step, await run_step(db)] as const;
  } catch (error) {
    const error_message = error instanceof Error ? error.message : String(error);
    log.error(`minute maintenance step ${step} failed`, { error: error_message });
    return [step, { failed: error_message }] as const;
  }
}

export async function run_minute_maintenance(db: Database): Promise<MinuteMaintenanceResult> {
  const entries = await Promise.all(
    Object.entries(minute_maintenance_steps).map(([step, run_step]) =>
      run_maintenance_step(db, step, run_step),
    ),
  );
  const result = Object.fromEntries(entries) as MinuteMaintenanceResult;
  log.info(`minute maintenance ran: ${JSON.stringify(result)}`);
  return result;
}
