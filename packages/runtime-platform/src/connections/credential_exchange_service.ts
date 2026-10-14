import type { Database } from '@coworker/core';
import { parse_app_config } from '@coworker/core/credentials/app_credential_config';
import {
  type CredentialExchangeResult,
  run_credential_exchange,
} from '@coworker/core/credentials/credential_exchange';
import type { CredentialExchangeOutcome } from '@coworker/core/credentials/credential_exchange_state';
import {
  type AttemptDecision,
  type CredentialExchangeState,
  decide_whether_to_attempt,
  generate_credential_exchange_state,
  read_credential_exchange_state,
} from '@coworker/core/credentials/credential_exchange_state';
import {
  drop_rules_from_a_previous_exchange,
  exchanged_value_prefix,
  generate_delivery_rules_for_exchanged_headers,
  generate_exchanged_credential_values,
} from '@coworker/core/credentials/exchanged_credential_delivery';
import {
  type ConnectionAwaitingExchange,
  find_connection_awaiting_exchange,
  record_failed_credential_exchange,
  save_exchanged_credential,
} from '@coworker/core/db/queries/connection_credential_exchange';
import type { ConnectionCredentialData } from '@coworker/core/db/schema/json_column_types';
import { read_connection_credential_values } from '@coworker/core/integrations/credential_envelope';

type CredentialExchangeReportOutcome =
  | Exclude<CredentialExchangeOutcome, 'succeeded'>
  | 'nothing_to_exchange';

export type CredentialExchangeReport =
  | { exchanged: true; delivers_headers: string[]; expires_time: string | null }
  | {
      exchanged: false;
      outcome: CredentialExchangeReportOutcome;
      message: string;
      retry_allowed_after_time?: string | undefined;
    };

export async function exchange_credential_for_connection(input: {
  db: Database;
  workspace_id: string;
  connection_id: string;
  now?: Date | undefined;
}): Promise<CredentialExchangeReport> {
  const now = input.now ?? new Date();
  const connection = await find_connection_awaiting_exchange(input.db, input);
  if (!connection) throw new Error('connection_not_found');

  const method = parse_app_config(connection.app_config).exchange_the_credential_by;
  if (!method) {
    return {
      exchanged: false,
      outcome: 'nothing_to_exchange',
      message: 'This credential is used as it was entered, so there is nothing to renew.',
    };
  }

  const previous = read_credential_exchange_state(connection.connection_config);
  const decision = decide_whether_to_attempt({
    state: previous,
    now,
    stop_after_failures: method.stop_after_failed_attempts,
  });
  if (!decision.may_attempt) return report_refusal(decision);

  const result = await run_credential_exchange({
    method,
    held_values: read_held_credential_values(connection.credentials),
    allowed_hosts: connection.allowed_hosts,
  });
  return result.exchanged
    ? await save_successful_exchange({ ...input, connection, result, previous, now })
    : await save_unsuccessful_exchange({ ...input, connection, result, previous, now });
}

function read_held_credential_values(
  credentials: ConnectionCredentialData | null,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(read_connection_credential_values(credentials)).filter(
      ([key]) => !key.startsWith(exchanged_value_prefix),
    ),
  );
}

type SaveInput = {
  db: Database;
  connection: ConnectionAwaitingExchange;
  previous: CredentialExchangeState | null;
  now: Date;
};

async function save_successful_exchange(
  input: SaveInput & { result: Extract<CredentialExchangeResult, { exchanged: true }> },
): Promise<CredentialExchangeReport> {
  const { result, connection, now } = input;
  const expiry_time = result.session_lasts_minutes
    ? new Date(now.getTime() + result.session_lasts_minutes * 60_000)
    : null;

  await save_exchanged_credential(input.db, {
    connection,
    exchanged_values: generate_exchanged_credential_values(result.deliver_as_headers),
    delivery_rules: [
      ...drop_rules_from_a_previous_exchange(
        parse_app_config(connection.app_config).add_to_every_request,
      ),
      ...generate_delivery_rules_for_exchanged_headers({
        headers: result.deliver_as_headers,
        hosts: connection.allowed_hosts,
        confirmed_time: now,
      }),
    ],
    api_protocol_headers: result.api_protocol_headers,
    expiry_time,
    state: generate_credential_exchange_state({
      previous: input.previous,
      outcome: 'succeeded',
      now,
    }),
  });

  return {
    exchanged: true,
    delivers_headers: Object.keys(result.deliver_as_headers),
    expires_time: expiry_time?.toISOString() ?? null,
  };
}

async function save_unsuccessful_exchange(
  input: SaveInput & { result: Extract<CredentialExchangeResult, { exchanged: false }> },
): Promise<CredentialExchangeReport> {
  const { result, now } = input;
  const state = generate_credential_exchange_state({
    previous: input.previous,
    outcome: result.outcome,
    now,
    vendor_message: result.message,
    ...(result.wait_minutes ? { wait_minutes: result.wait_minutes } : {}),
  });
  await record_failed_credential_exchange(input.db, { connection: input.connection, state });

  return {
    exchanged: false,
    outcome: result.outcome,
    message: result.message,
    ...(state.retry_allowed_after_time
      ? { retry_allowed_after_time: state.retry_allowed_after_time }
      : {}),
  };
}

function report_refusal(decision: Extract<AttemptDecision, { may_attempt: false }>) {
  return {
    exchanged: false as const,
    outcome: decision.outcome,
    message: decision.reason,
    ...(decision.retry_allowed_after_time
      ? { retry_allowed_after_time: decision.retry_allowed_after_time }
      : {}),
  };
}
