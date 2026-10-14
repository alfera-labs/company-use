import { env, require_database_url } from '@coworker/config';
import type { Database } from '@coworker/core/db/connection';
import { create_logger, format_error_message } from '@coworker/shared';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';

const log = create_logger('wake_channel');

// "Look now" between two processes, over Postgres.
//
// Some work waits on a fact another service writes: a run waiting for a person to answer, held
// open in its own turn. Reading for that fact on a timer means the waiter is, on average, half an
// interval behind the truth. A shorter interval buys latency with load, and every run waiting at
// once pays it.
//
// So the writer says when. `NOTIFY` is delivered by Postgres only when the transaction that sent
// it commits, which is the ordering this needs: the waiter can never be told to look before the
// row is there to be found.
//
// This is an accelerator and never the source of truth. A waiter still reads the database to learn
// what the answer was, and still has its own slow backstop, so a dropped notification costs one
// backstop interval rather than the answer.

export type WakeWatch = {
  wait_for_a_wake(patience_ms: number, signal?: AbortSignal): Promise<void>;
  stop(): void;
};

type WakeCallback = () => void;

const callbacks_by_channel = new Map<string, Map<string, Set<WakeCallback>>>();
const listening_channels = new Set<string>();
let listening_client: postgres.Sql | null = null;
let listening_is_unavailable = false;

export async function announce_wake(db: Database, channel: string, key: string) {
  try {
    await db.execute(sql`select pg_notify(${channel}, ${key})`);
  } catch (error) {
    log.warn('announcing a wake failed; waiters fall back to their backstop', {
      channel,
      error: format_error_message(error),
    });
  }
}

export function watch_for_wake(channel: string, key: string): WakeWatch {
  let is_awake = false;
  let take_the_wake: WakeCallback | null = null;

  const on_wake = () => {
    is_awake = true;
    take_the_wake?.();
  };
  add_callback(channel, key, on_wake);
  void listen_to_channel(channel);

  return {
    async wait_for_a_wake(patience_ms, signal) {
      if (is_awake || signal?.aborted) {
        is_awake = false;
        return;
      }
      await new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', finish);
          take_the_wake = null;
          resolve();
        };
        const timer = setTimeout(finish, patience_ms);
        take_the_wake = finish;
        signal?.addEventListener('abort', finish, { once: true });
      });
      is_awake = false;
    },
    stop: () => remove_callback(channel, key, on_wake),
  };
}

export function wake_the_waiters(channel: string, key: string) {
  const callbacks = callbacks_by_channel.get(channel)?.get(key);
  if (!callbacks) return;
  for (const callback of [...callbacks]) callback();
}

function add_callback(channel: string, key: string, callback: WakeCallback) {
  const by_key = callbacks_by_channel.get(channel) ?? new Map<string, Set<WakeCallback>>();
  callbacks_by_channel.set(channel, by_key);
  const callbacks = by_key.get(key) ?? new Set<WakeCallback>();
  by_key.set(key, callbacks);
  callbacks.add(callback);
}

function remove_callback(channel: string, key: string, callback: WakeCallback) {
  const by_key = callbacks_by_channel.get(channel);
  const callbacks = by_key?.get(key);
  if (!callbacks || !by_key) return;
  callbacks.delete(callback);
  if (callbacks.size === 0) by_key.delete(key);
}

// One connection per process, shared by every channel and every waiter on it.
//
// postgres.js multiplexes all LISTENs over a single dedicated connection, so this cannot grow with
// the number of waiters. It is deliberately its own connection rather than one borrowed from the
// query pool: a LISTEN holds its connection for as long as it listens, and a pool that lends one
// out permanently is a pool one connection smaller for everything else.
async function listen_to_channel(channel: string) {
  if (listening_channels.has(channel) || listening_is_unavailable) return;
  listening_channels.add(channel);

  const client = get_listening_client();
  if (!client) return;
  try {
    await client.listen(channel, (payload) => wake_the_waiters(channel, payload));
  } catch (error) {
    listening_channels.delete(channel);
    log.warn('listening for wakes failed; waiters fall back to their backstop', {
      channel,
      error: format_error_message(error),
    });
  }
}

function get_listening_client() {
  if (listening_client) return listening_client;
  if (env.NODE_ENV === 'test') {
    listening_is_unavailable = true;
    return null;
  }
  try {
    listening_client = postgres(require_database_url(), { max: 1, prepare: false });
  } catch (error) {
    listening_is_unavailable = true;
    log.warn('no connection for wakes; waiters fall back to their backstop', {
      error: format_error_message(error),
    });
  }
  return listening_client;
}
