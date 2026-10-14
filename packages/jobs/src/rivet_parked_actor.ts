import { create_logger, give_up_after } from '@coworker/shared';

export type RivetEngineAccess = { endpoint: string; namespace?: string; token?: string };

const log = create_logger('rivet_parked_actor');
const engine_call_time_limit_ms = 2_000;

type EngineActor = { actor_id: string; error?: unknown; connectable_ts?: number | null };

export async function destroy_actor_if_parked(
  engine: RivetEngineAccess,
  actor: { resolve(): Promise<string> },
) {
  try {
    const actor_id = await give_up_after(
      actor.resolve(),
      engine_call_time_limit_ms,
      'The Rivet engine',
    );
    const state = await read_engine_actor(engine, actor_id);
    if (state?.error !== 'no_envoys' || state.connectable_ts) return false;
    await call_engine(engine, 'DELETE', `/actors/${encodeURIComponent(actor_id)}`);
    log.warn('destroyed an actor the Rivet engine had parked; the next call makes a new one', {
      actor_id,
    });
    return true;
  } catch (error) {
    log.error('checking a Rivet actor for a park failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

async function read_engine_actor(engine: RivetEngineAccess, actor_id: string) {
  const response = await call_engine(engine, 'GET', `/actors?actor_ids=${actor_id}`);
  const body = (await response.json()) as { actors?: EngineActor[] };
  return body.actors?.find((actor) => actor.actor_id === actor_id);
}

async function call_engine(engine: RivetEngineAccess, method: 'GET' | 'DELETE', path: string) {
  const endpoint = new URL(engine.endpoint);
  const namespace = engine.namespace ?? (decodeURIComponent(endpoint.username) || 'default');
  const token = engine.token ?? decodeURIComponent(endpoint.password);
  const url = new URL(path, endpoint.origin);
  url.searchParams.set('namespace', namespace);
  const response = await fetch(url, {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(engine_call_time_limit_ms),
  });
  if (!response.ok)
    throw new Error(`The Rivet engine answered ${method} ${path} with ${response.status}.`);
  return response;
}
