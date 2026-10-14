import type { WorkerRegistry } from '@worker/registry';
import { capture_worker_exception } from '@worker/worker_sentry';
import type { WorkerServices } from '@worker/worker_services';

const retry_delays_ms = [2_000, 5_000, 10_000, 30_000] as const;
const shutdown_limit_ms = 10_000;

type Wait = (ms: number) => Promise<void>;

export function engine_origin(endpoint: string) {
  return new URL(endpoint).origin;
}

export function register_with_rivet(
  services: WorkerServices,
  create_registry: () => WorkerRegistry,
  wait: Wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<WorkerRegistry> {
  return register_until_it_works(services, create_registry, wait, 1);
}

async function register_until_it_works(
  services: WorkerServices,
  create_registry: () => WorkerRegistry,
  wait: Wait,
  attempt: number,
): Promise<WorkerRegistry> {
  const registry = create_registry();
  try {
    await registry.startAndWait();
    if (attempt > 1) services.log.info(`the worker registered with Rivet on attempt ${attempt}`);
    return registry;
  } catch (error) {
    const delay_ms = retry_delays_ms[Math.min(attempt, retry_delays_ms.length) - 1] ?? 30_000;
    report_failed_attempt(services, error, attempt, delay_ms);
    await shut_down(services, registry);
    await wait(delay_ms);
  }
  return register_until_it_works(services, create_registry, wait, attempt + 1);
}

function report_failed_attempt(
  services: WorkerServices,
  error: unknown,
  attempt: number,
  delay_ms: number,
) {
  services.log.error(
    `the worker did not register with Rivet (attempt ${attempt}); it tries again in ${delay_ms / 1000} s`,
    { error: error instanceof Error ? error.message : String(error) },
  );
  if (attempt === 1) capture_worker_exception(error, { failure: 'rivet_registration' });
}

async function shut_down(services: WorkerServices, registry: WorkerRegistry) {
  const limit = new Promise((resolve) => setTimeout(resolve, shutdown_limit_ms));
  const shutdown = registry.shutdown().catch((error) => {
    services.log.warn('the failed Rivet registration did not shut down', {
      error: error instanceof Error ? error.message : String(error),
    });
  });
  await Promise.race([shutdown, limit]);
}
