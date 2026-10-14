import { setTimeout as wait } from 'node:timers/promises';
import type { Database, DatabaseExecutor } from '@coworker/core/db/connection';
import { AppError, create_logger, format_error_message } from '@coworker/shared';
import { chatgpt_plan_value_names } from '@runtime-platform/chatgpt_plan/chatgpt_plan_oauth';
import {
  chatgpt_sign_in_renewal_is_due,
  refresh_chatgpt_sign_in,
} from '@runtime-platform/chatgpt_plan/chatgpt_plan_renewal';

const log = create_logger('chatgpt_plan_renewal');
export const chatgpt_plan_renewal_actor_id = 'system:chatgpt_plan_token_refresh';
const seconds_a_renewal_claim_lasts = 60;
const milliseconds_between_looks_at_a_renewal = 500;

/** Where one ChatGPT plan sign-in is stored: one workspace, or the whole install. */
export type ChatgptPlanSignInStore = {
  read_values: (db: DatabaseExecutor) => Promise<Record<string, string> | null>;
  claim_renewal: (db: DatabaseExecutor, claimed_until: Date) => Promise<boolean>;
  lock_values: (db: DatabaseExecutor) => Promise<Record<string, string> | null>;
  save_values: (db: DatabaseExecutor, values: Record<string, string>) => Promise<void>;
  mark_invalid: (db: DatabaseExecutor, error_message: string) => Promise<void>;
};

type RefreshOutcome = { values: Record<string, string> } | { error: unknown };

/**
 * Refresh tokens rotate, so a sign-in is renewed by one caller at a time: the caller that
 * claims the renewal. A caller whose access token has already ended waits for that renewal.
 * The calls to ChatGPT hold no lock and no transaction, and each has a
 * time limit shorter than the claim. The result is written only while the stored refresh token
 * is still the one that was spent, so a newer sign-in or a newer renewal always wins.
 */
export async function renew_chatgpt_plan_sign_in(
  db: Database,
  store: ChatgptPlanSignInStore,
): Promise<void> {
  if (!(await read_due_values(db, store))) return;
  const claimed_until = new Date(Date.now() + seconds_a_renewal_claim_lasts * 1000);
  if (!(await store.claim_renewal(db, claimed_until))) {
    return wait_while_another_caller_renews(db, store, claimed_until.getTime());
  }
  const spent = await read_due_values(db, store);
  if (!spent) return;
  const outcome: RefreshOutcome = await refresh_chatgpt_sign_in(spent).then(
    (values) => ({ values }),
    (error: unknown) => ({ error }),
  );
  await write_while_refresh_token_is(db, store, spent, outcome);
}

async function wait_while_another_caller_renews(
  db: DatabaseExecutor,
  store: ChatgptPlanSignInStore,
  give_up_time_ms: number,
): Promise<void> {
  const values = await store.read_values(db);
  const has_expired = Number(values?.[chatgpt_plan_value_names.expires_at] ?? '') <= Date.now();
  if (!values || !has_expired || Date.now() >= give_up_time_ms) return;
  await wait(milliseconds_between_looks_at_a_renewal);
  return wait_while_another_caller_renews(db, store, give_up_time_ms);
}

async function read_due_values(db: DatabaseExecutor, store: ChatgptPlanSignInStore) {
  const values = await store.read_values(db);
  return values && chatgpt_sign_in_renewal_is_due(values) ? values : null;
}

async function write_while_refresh_token_is(
  db: Database,
  store: ChatgptPlanSignInStore,
  spent: Record<string, string>,
  outcome: RefreshOutcome,
) {
  await db.transaction(async (transaction) => {
    const current = await store.lock_values(transaction);
    const name = chatgpt_plan_value_names.refresh_token;
    if (!current || current[name] !== spent[name]) {
      log.info('a newer ChatGPT plan sign-in is stored; this renewal is not saved');
      return;
    }
    if ('values' in outcome) return store.save_values(transaction, outcome.values);
    if (ends_the_sign_in(outcome.error)) {
      return store.mark_invalid(transaction, format_error_message(outcome.error));
    }
    log.warn('could not renew a ChatGPT plan token; the next run tries again', outcome.error);
  });
}

function ends_the_sign_in(error: unknown) {
  return error instanceof AppError && error.code === 'chatgpt_sign_in_expired';
}
