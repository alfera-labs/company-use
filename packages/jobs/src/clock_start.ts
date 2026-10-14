import { destroy_actor_if_parked, type RivetEngineAccess } from '@coworker/jobs/rivet_parked_actor';
import { AppError, create_logger, give_up_after } from '@coworker/shared';

export const clock_key_name = 'clock';
export type ClockKey = [key_scope: string, name: typeof clock_key_name];

export function build_clock_key(key_scope: string): ClockKey {
  return [key_scope, clock_key_name];
}

export function read_clock_key(key: readonly string[], own_key_scope: string) {
  const [key_scope, name, ...rest] = key;
  if (key_scope !== own_key_scope || name !== clock_key_name || rest.length > 0) {
    throw new AppError(
      'clock_key_refused',
      `This worker runs the clock [${own_key_scope}, ${clock_key_name}], not ${JSON.stringify(key)}.`,
      403,
    );
  }
  return key_scope;
}

type ClockHandle = { arm(wake_by_ms?: number): Promise<unknown>; resolve(): Promise<string> };
export type ClockLookup = {
  clock: { getOrCreate(key: string[], options: { createInRegion?: string }): ClockHandle };
};

const log = create_logger('clock_start');
const arm_time_limit_ms = 10_000;

export function create_clock_start(
  lookup: ClockLookup,
  input: { key_scope: string; region?: string | undefined; engine: RivetEngineAccess },
) {
  const region = input.region ? { createInRegion: input.region } : {};
  const find_clock = () => lookup.clock.getOrCreate(build_clock_key(input.key_scope), region);
  return async function start_clock(wake_by_ms?: number) {
    if (await arm_clock(find_clock(), input.key_scope, wake_by_ms)) return;
    if (await destroy_actor_if_parked(input.engine, find_clock())) {
      await arm_clock(find_clock(), input.key_scope, wake_by_ms);
    }
  };
}

async function arm_clock(clock: ClockHandle, key_scope: string, wake_by_ms?: number) {
  try {
    await give_up_after(clock.arm(wake_by_ms), arm_time_limit_ms, 'The Rivet engine');
    return true;
  } catch (error) {
    log.error('arming the clock actor failed; the next arm tries again', {
      key_scope,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
