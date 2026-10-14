import { createHash, randomBytes } from 'node:crypto';
import type { TriggerConfigData } from '@coworker/core/db/schema/json_column_types';
import { secure_strings_equal } from '@coworker/shared/secure_strings_equal';
import type { TriggerRow } from '@runtime-platform/events/trigger_ingress';
import {
  read_web_call_address,
  type WebCallAddress,
} from '@runtime-platform/triggers/web_call_address';

/**
 * A trigger row as the call that made it answers. `new_webhook_secret` is the bearer secret of a
 * web-call trigger, present only in the answer of the call that created the trigger. It is not
 * stored, so no later read can show it.
 */
export type TriggerRowWithNewSecret = TriggerRow & { new_webhook_secret?: string | undefined };

/** A new bearer secret, and the hash of it that is the only thing the trigger row keeps. */
export function create_trigger_webhook_secret() {
  const new_webhook_secret = randomBytes(32).toString('hex');
  return { new_webhook_secret, webhook_secret_hash: hash_webhook_secret(new_webhook_secret) };
}

function hash_webhook_secret(secret: string) {
  return createHash('sha256').update(secret).digest('hex');
}

/**
 * True when the presented bearer is this web-call trigger's secret. A row made before secrets
 * were stored hashed keeps its plain `webhook_secret`, and the address it was given still works.
 */
export function trigger_webhook_secret_matches(config: TriggerConfigData, presented: string) {
  const stored_hash = config.webhook_secret_hash;
  if (typeof stored_hash === 'string' && stored_hash) {
    return secure_strings_equal(hash_webhook_secret(presented), stored_hash);
  }
  const plain_secret = config.webhook_secret;
  return plain_secret ? secure_strings_equal(presented, plain_secret) : false;
}

type AnsweredTrigger = {
  trigger_id: string;
  trigger_type: string;
  trigger_config: TriggerConfigData;
};

/**
 * The row as an API answer may carry it: without the bearer secret of an older web-call trigger,
 * without the signing secret a provider gave for its deliveries, and without the stored hash.
 * A web-call trigger also carries the address it is called at, which is no secret.
 */
export function hide_trigger_webhook_secret<Trigger extends AnsweredTrigger>(
  trigger: Trigger,
): Trigger & { web_call_address?: WebCallAddress } {
  const {
    webhook_secret: _secret,
    webhook_secret_hash: _hash,
    ...trigger_config
  } = trigger.trigger_config;
  if (trigger.trigger_type !== 'webhook') return { ...trigger, trigger_config };
  return {
    ...trigger,
    trigger_config,
    web_call_address: read_web_call_address(trigger.trigger_id),
  };
}

export function hide_webhook_secrets_of_triggers<Holder extends { triggers: AnsweredTrigger[] }>(
  holder: Holder,
) {
  return {
    ...holder,
    triggers: holder.triggers.map((trigger: Holder['triggers'][number]) =>
      hide_trigger_webhook_secret(trigger),
    ),
  };
}

/** Puts the secrets shown at creation back on rows that were read again before the answer. */
export function carry_new_webhook_secrets(
  rows_at_creation: TriggerRowWithNewSecret[],
  rows: TriggerRow[],
): TriggerRowWithNewSecret[] {
  const secrets = new Map(
    rows_at_creation.flatMap((row) =>
      row.new_webhook_secret ? [[row.trigger_id, row.new_webhook_secret] as const] : [],
    ),
  );
  return rows.map((row) => {
    const new_webhook_secret = secrets.get(row.trigger_id);
    return new_webhook_secret ? { ...row, new_webhook_secret } : row;
  });
}
