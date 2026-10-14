import type { DatabaseExecutor } from '@coworker/core/db/connection';
import {
  delete_install_connection,
  type InstallConnectionRow,
  list_install_connections,
  mark_install_connection_invalid,
  save_install_connection,
} from '@coworker/core/db/queries/install_connections';
import type { ModelProviderAccount } from '@coworker/core/db/queries/model_provider_accounts';
import {
  read_connection_credential_value,
  read_connection_credential_values,
} from '@coworker/core/integrations/credential_envelope';
import {
  type ModelProviderAccountSlot,
  model_provider_account_connection_key,
  model_provider_account_slots,
} from '@coworker/core/integrations/model_provider_account_slots';
import { AppError, format_error_message } from '@coworker/shared';

const install_account_slots = Object.keys(
  model_provider_account_slots,
) as ModelProviderAccountSlot[];

const slot_by_connection_key = new Map(
  install_account_slots.map((slot) => [model_provider_account_connection_key(slot), slot]),
);

export async function save_install_model_provider_account(
  db: DatabaseExecutor,
  input: {
    provider_slot: ModelProviderAccountSlot;
    values: Record<string, string>;
    actor_id: string;
  },
): Promise<ModelProviderAccount> {
  const env_name = model_provider_account_slots[input.provider_slot].env_name;
  const secret_hint = (input.values[env_name] ?? '').slice(-4);
  await save_install_connection(db, {
    connection_key: model_provider_account_connection_key(input.provider_slot),
    values: input.values,
    connection_metadata: { secret_hint, error_message: null },
    actor_id: input.actor_id,
  });
  return {
    provider_slot: input.provider_slot,
    display_name: model_provider_account_slots[input.provider_slot].display_name,
    secret_hint,
    credential_status: 'active',
    last_validated_time: new Date(),
    error_message: null,
  };
}

export async function list_install_model_provider_accounts(
  db: DatabaseExecutor,
): Promise<ModelProviderAccount[]> {
  const rows = await list_install_connections(db, [...slot_by_connection_key.keys()]);
  return rows.flatMap((row) => {
    const provider_slot = slot_by_connection_key.get(row.connection_key);
    return provider_slot ? [describe_install_account(provider_slot, row)] : [];
  });
}

export async function read_install_model_provider_account_values(
  db: DatabaseExecutor,
): Promise<Record<string, string>> {
  const rows = await list_install_connections(db, [...slot_by_connection_key.keys()]);
  return Object.fromEntries(
    rows.flatMap((row) => {
      const provider_slot = slot_by_connection_key.get(row.connection_key);
      if (!provider_slot || row.connection_status !== 'active') return [];
      const slot = model_provider_account_slots[provider_slot];
      return [slot.env_name, ...slot.shared_value_names].flatMap((value_name) => {
        const value = decrypt_install_value(row, value_name, provider_slot);
        return value === null ? [] : [[value_name, value] as const];
      });
    }),
  );
}

export function delete_install_model_provider_account(
  db: DatabaseExecutor,
  provider_slot: ModelProviderAccountSlot,
): Promise<boolean> {
  return delete_install_connection(db, model_provider_account_connection_key(provider_slot));
}

function describe_install_account(
  provider_slot: ModelProviderAccountSlot,
  row: InstallConnectionRow,
): ModelProviderAccount {
  const secret_hint = row.connection_metadata.secret_hint;
  const error_message = row.connection_metadata.error_message;
  return {
    provider_slot,
    display_name: model_provider_account_slots[provider_slot].display_name,
    secret_hint: typeof secret_hint === 'string' ? secret_hint : '',
    credential_status: row.connection_status === 'active' ? 'active' : 'invalid',
    last_validated_time: row.last_checked_time,
    error_message: typeof error_message === 'string' && error_message ? error_message : null,
  };
}

function decrypt_install_value(
  row: InstallConnectionRow,
  env_name: string,
  provider_slot: ModelProviderAccountSlot,
): string | null {
  try {
    return read_connection_credential_value(row.credentials, env_name);
  } catch (error) {
    throw new AppError(
      'install_model_key_unreadable',
      `The stored ${provider_slot} key of this server could not be decrypted.`,
      500,
      { provider_slot, cause: format_error_message(error) },
    );
  }
}

export async function read_install_model_provider_account_stored_values(
  db: DatabaseExecutor,
  provider_slot: ModelProviderAccountSlot,
): Promise<Record<string, string> | null> {
  const [row] = await list_install_connections(db, [
    model_provider_account_connection_key(provider_slot),
  ]);
  if (!row || row.connection_status !== 'active') return null;
  return read_connection_credential_values(row.credentials);
}

export function mark_install_model_provider_account_invalid(
  db: DatabaseExecutor,
  input: { provider_slot: ModelProviderAccountSlot; error_message: string; actor_id: string },
): Promise<void> {
  return mark_install_connection_invalid(db, {
    connection_key: model_provider_account_connection_key(input.provider_slot),
    error_message: input.error_message,
    actor_id: input.actor_id,
  });
}
