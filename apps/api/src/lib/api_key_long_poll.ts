import type { Database } from '@coworker/core';
import { type ApiKey, find_api_key_by_id } from '@coworker/core/db/queries/api_keys';
import { AppError } from '@coworker/shared';

// Counted in this process. With N API instances a key can hold N times this many; move
// the count onto the api_keys row if that ceiling ever matters.
export const max_open_long_polls_per_api_key = 5;

const open_long_polls_by_api_key = new Map<string, number>();

export function open_long_poll_slot(api_key_id: string): () => void {
  const open = open_long_polls_by_api_key.get(api_key_id) ?? 0;
  if (open >= max_open_long_polls_per_api_key) {
    throw new AppError(
      'too_many_open_streams',
      `This API key already holds ${max_open_long_polls_per_api_key} open streams or waits. Close one, or wait for one to finish.`,
      429,
      { max_open_streams: max_open_long_polls_per_api_key },
    );
  }
  open_long_polls_by_api_key.set(api_key_id, open + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const remaining = (open_long_polls_by_api_key.get(api_key_id) ?? 1) - 1;
    if (remaining > 0) open_long_polls_by_api_key.set(api_key_id, remaining);
    else open_long_polls_by_api_key.delete(api_key_id);
  };
}

export async function api_key_is_still_live(db: Database, api_key: ApiKey): Promise<boolean> {
  const current = await find_api_key_by_id(db, api_key.api_key_id);
  return current?.key_status === 'active';
}

export async function assert_api_key_still_live(db: Database, api_key: ApiKey): Promise<void> {
  if (await api_key_is_still_live(db, api_key)) return;
  throw new AppError(
    'api_key_revoked',
    'This API key was revoked or expired while the request was open',
    401,
  );
}

export function sleep_unless_aborted(signal: AbortSignal, milliseconds: number): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener('abort', finish, { once: true });
  });
}
