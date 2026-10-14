import type { WorkerRegistry } from '@worker/registry';
import { start_repeating_task } from '@worker/repeating_task';
import { register_with_rivet } from '@worker/worker_registration';
import { capture_worker_exception } from '@worker/worker_sentry';
import type { WorkerServices } from '@worker/worker_services';

export type RegistrationWatchTiming = { check_interval_ms: number; lost_budget_ms: number };

const default_timing: RegistrationWatchTiming = {
  check_interval_ms: 5_000,
  lost_budget_ms: 60_000,
};

const stale_link_threshold_ms = 20_000;

type WatchState = { registry: WorkerRegistry; last_registered_ms: number; lost_is_logged: boolean };

export function start_registration_watch(
  services: WorkerServices,
  input: {
    registry: WorkerRegistry;
    create_registry: () => WorkerRegistry;
    timing?: Partial<RegistrationWatchTiming>;
  },
) {
  const timing = { ...default_timing, ...input.timing };
  const state: WatchState = {
    registry: input.registry,
    last_registered_ms: services.now().getTime(),
    lost_is_logged: false,
  };
  const stop_checks = start_repeating_task(services, {
    task_name: 'rivet registration check',
    interval_ms: timing.check_interval_ms,
    run: () => check_registration(services, state, timing, input.create_registry),
  });
  return {
    read_registry: () => state.registry,
    stop: async () => {
      stop_checks();
      await state.registry.shutdown();
    },
  };
}

async function check_registration(
  services: WorkerServices,
  state: WatchState,
  timing: RegistrationWatchTiming,
  create_registry: () => WorkerRegistry,
) {
  const now_ms = services.now().getTime();
  if ((await state.registry.routes.health()).status === 200) {
    if (state.lost_is_logged) {
      services.log.info(
        `the worker is registered with Rivet again after about ${outage_seconds(now_ms - state.last_registered_ms)} s`,
      );
    }
    Object.assign(state, { last_registered_ms: now_ms, lost_is_logged: false });
    return;
  }
  const lost_ms = now_ms - state.last_registered_ms;
  if (!state.lost_is_logged && lost_ms >= timing.check_interval_ms) {
    services.log.warn(
      'the worker lost its Rivet registration (no engine ping for 20 s); new actors cannot start here',
    );
    state.lost_is_logged = true;
  }
  if (lost_ms >= timing.lost_budget_ms) await replace_registry(services, state, create_registry);
}

async function replace_registry(
  services: WorkerServices,
  state: WatchState,
  create_registry: () => WorkerRegistry,
) {
  const lost_ms = services.now().getTime() - state.last_registered_ms;
  services.log.error(
    `the worker was not registered with Rivet for about ${outage_seconds(lost_ms)} s; it registers a new registry`,
  );
  capture_worker_exception(new Error('The worker lost its Rivet registration.'), {
    failure: 'rivet_registration_lost',
  });
  await state.registry.shutdown();
  state.registry = await register_with_rivet(services, create_registry);
  services.log.info('the worker is registered with Rivet again with a new registry');
  Object.assign(state, { last_registered_ms: services.now().getTime(), lost_is_logged: false });
}

function outage_seconds(stale_ms: number) {
  return Math.round((stale_ms + stale_link_threshold_ms) / 1000);
}
