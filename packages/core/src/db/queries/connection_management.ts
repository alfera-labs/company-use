import { createHash, randomBytes } from 'node:crypto';
import type { Database, DatabaseExecutor } from '@coworker/core/db/connection';
import {
  build_restricted_access_config,
  type ConnectionAccessType,
} from '@coworker/core/db/queries/connection_access';
import {
  connection_visibility_condition,
  open_connection_to_everyone,
  restrict_connection_to_one_person,
} from '@coworker/core/db/queries/connection_people';
import { require_inserted_row } from '@coworker/core/db/queries/require_inserted_row';
import { agents, apps, connections } from '@coworker/core/db/schema';
import { updated_by } from '@coworker/core/db/schema/common';
import type {
  ConnectionCredentialData,
  ConnectionResumeIntentData,
  ConnectionSetupStateData,
} from '@coworker/core/db/schema/json_column_types';
import {
  type AgentEnabledNode,
  parse_agent_enabled_nodes,
  write_agent_enabled_nodes,
} from '@coworker/core/integrations/agent_enabled_nodes';
import {
  find_active_connection_profile,
  find_active_provider_config,
  parse_app_provider_configs,
} from '@coworker/core/integrations/app_provider_configs';
import {
  redact_connection,
  redact_connection_with_app,
} from '@coworker/core/integrations/connection_dto';
import { is_hosted_setup_strategy } from '@coworker/core/integrations/connection_setup_strategies';
import {
  add_connection_credential_values,
  encrypt_connection_credentials,
  replace_connection_credential_values,
} from '@coworker/core/integrations/credential_envelope';
import {
  is_mcp_header_credential_key,
  mcp_header_credential_key,
} from '@coworker/core/integrations/mcp_credential_keys';
import { model_provider_account_app_names } from '@coworker/core/integrations/model_provider_account_slots';
import {
  build_oauth_setup_state,
  is_oauth_setup_strategy,
} from '@coworker/core/integrations/oauth_setup';
import type { OAuthTokenResponseData } from '@coworker/core/integrations/oauth_token_response';
import { AppError, create_id, id_prefixes, NotFoundError, ValidationError } from '@coworker/shared';
import { secure_strings_equal } from '@coworker/shared/secure_strings_equal';
import { and, asc, desc, eq, inArray, isNull, lte, ne, notInArray, or, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core/query-builders/update';

type CreateConnectionInput = {
  workspace_id: string;
  app_id: string;
  provider_key?: string | undefined;
  provider_config_key?: string | undefined;
  connection_profile_key?: string | undefined;
  connection_name?: string | undefined;
  redirect_uri?: string | undefined;
  setup_session_id?: string | undefined;
  resume?: ConnectionResumeIntentData | undefined;
  access_type?: ConnectionAccessType | undefined;
  oauth_client_secret?: string | undefined;
  request_headers?: Record<string, string> | undefined;
  actor_id: string;
};

type FinalizeProviderConnectionInput = {
  workspace_id: string;
  provider_key: string;
  connection_id: string;
  status: 'success' | 'error';
  external_account_id?: string | undefined;
  external_account_name?: string | undefined;
  authorized_scopes?: string[] | undefined;
  provider_account?: Record<string, unknown> | undefined;
  error_message?: string | undefined;
  actor_id: string;
};

type ConnectionSetupProfile = {
  provider_key: string;
  provider_config_key: string;
  provider_config_version: number;
  provider_app_key?: string | undefined;
  connection_profile_key: string;
  connection_profile_version: number;
  auth_method_key: string;
  setup_strategy: Record<string, unknown>;
  default_scopes: string[];
};

type FinalizeOAuthConnectionInput = {
  workspace_id: string;
  state_token: string;
  status: 'success' | 'error';
  token_response?: OAuthTokenResponseData | undefined;
  error_message?: string | undefined;
  actor_id: string;
};

type PendingProviderConnectionSetup = {
  connection_id: string;
  workspace_id: string;
  provider_key: string;
  provider_config_key: string;
  setup_state: ConnectionSetupStateData;
  actor_id: string;
};

type PendingConnectionSetupByToken = PendingProviderConnectionSetup & {
  app_id: string;
  credentials: ConnectionCredentialData | null;
};

type CompletedConnectionSetupByToken = {
  connection_id: string;
  connection_status: 'active';
  provider_key: string;
};

function setup_credential_values(input: {
  oauth_client_secret?: string | undefined;
  request_headers?: Record<string, string> | undefined;
}): Record<string, string> | null {
  const values = {
    ...(input.oauth_client_secret ? { oauth_client_secret: input.oauth_client_secret } : {}),
    ...Object.fromEntries(
      Object.entries(input.request_headers ?? {}).map(([name, value]) => [
        mcp_header_credential_key(name),
        value,
      ]),
    ),
  };
  return Object.keys(values).length > 0 ? values : null;
}

function credentials_outliving_authorization(credentials: ConnectionCredentialData | null) {
  const stored = Object.keys(credentials?.encrypted_values ?? {});
  return ['oauth_client_secret', ...stored.filter(is_mcp_header_credential_key)];
}

export const pending_connection_setup_expiry_ms = 15 * 60 * 1000;

const connection_setup_expiry_actor = 'system:connection_setup_expiry';

const is_not_a_model_provider_account = or(
  isNull(apps.app_name),
  notInArray(apps.app_name, [...model_provider_account_app_names]),
);

export async function list_redacted_connections(
  db: Database,
  workspace_id: string,
  acting_user_id?: string,
) {
  const rows = await db
    .select({ connection: connections, app: apps })
    .from(connections)
    .leftJoin(apps, eq(connections.app_id, apps.app_id))
    .where(
      and(
        eq(connections.workspace_id, workspace_id),
        ne(connections.connection_status, 'expired'),
        is_not_a_model_provider_account,
        ...(acting_user_id ? [connection_visibility_condition(acting_user_id)] : []),
      ),
    )
    .orderBy(connections.connection_name, connections.created_time);

  return rows.map((row) => redact_connection_with_app(row.connection, row.app));
}

export async function get_redacted_connection(
  db: Database,
  input: { workspace_id: string; connection_id: string; acting_user_id?: string },
) {
  const [row] = await db
    .select({ connection: connections, app: apps })
    .from(connections)
    .leftJoin(apps, eq(connections.app_id, apps.app_id))
    .where(
      and(
        eq(connections.workspace_id, input.workspace_id),
        eq(connections.connection_id, input.connection_id),
        is_not_a_model_provider_account,
        ...(input.acting_user_id ? [connection_visibility_condition(input.acting_user_id)] : []),
      ),
    )
    .limit(1);

  return row ? redact_connection_with_app(row.connection, row.app) : null;
}

export async function create_pending_connection_setup(db: Database, input: CreateConnectionInput) {
  await expire_stale_pending_connection_setups(db, { workspace_id: input.workspace_id });

  const app = await get_visible_workspace_app(db, input.workspace_id, input.app_id);
  if (!app) throw new NotFoundError('App');

  const selected_profile = find_connection_setup_profile(app, input);
  const resume_session_id = read_resume_session_id(input.resume);
  const resume_actor_id = read_resume_actor_id(input.resume);
  const setup_session_id = input.setup_session_id;
  const reusable_connection = await find_reusable_pending_connection_setup(db, {
    workspace_id: input.workspace_id,
    app_id: input.app_id,
    actor_id: input.actor_id,
    profile: selected_profile,
    ...(resume_session_id ? { resume_session_id } : {}),
    ...(resume_actor_id ? { resume_actor_id } : {}),
    ...(setup_session_id ? { setup_session_id } : {}),
    ...(input.connection_name ? { connection_name: input.connection_name } : {}),
  });
  if (reusable_connection) {
    const setup_state = add_resume_to_setup_state(
      add_setup_started_time_to_setup_state(
        add_setup_session_id_to_setup_state(
          add_missing_setup_token_to_setup_state(reusable_connection.setup_state),
          setup_session_id,
        ),
      ),
      input.resume,
    );
    const [connection] = await db
      .update(connections)
      .set({
        setup_state,
        ...(setup_credential_values(input)
          ? {
              credentials: add_connection_credential_values({
                existing: reusable_connection.credentials,
                credential_source: 'manual',
                values: setup_credential_values(input) ?? {},
              }),
            }
          : {}),
        last_updated_time: new Date(),
        last_updated_by: input.actor_id,
      })
      .where(
        and(
          eq(connections.workspace_id, input.workspace_id),
          eq(connections.connection_id, reusable_connection.connection_id),
          eq(connections.connection_status, 'pending_setup'),
        ),
      )
      .returning();
    if (!connection) throw new NotFoundError('Connection');

    return {
      connection: redact_connection(connection),
      setup: connection.setup_state,
    };
  }

  const connection_id = create_id(id_prefixes.connection);
  const external_user_key = `ws_${input.workspace_id}`;
  const setup_state = add_resume_to_setup_state(
    add_setup_session_id_to_setup_state(
      add_missing_setup_token_to_setup_state(
        build_setup_state({
          connection_id,
          external_user_key,
          provider_key: selected_profile.provider_key,
          ...(selected_profile.provider_app_key
            ? { provider_app_key: selected_profile.provider_app_key }
            : {}),
          ...(input.redirect_uri ? { redirect_uri: input.redirect_uri } : {}),
          setup_strategy: selected_profile.setup_strategy,
          default_scopes: selected_profile.default_scopes,
        }),
      ),
      setup_session_id,
    ),
    input.resume,
  );

  const [created_connection] = await db
    .insert(connections)
    .values({
      connection_id,
      workspace_id: input.workspace_id,
      app_id: input.app_id,
      connection_key: `${selected_profile.provider_key}:${app.app_name}:${connection_id}`,
      connection_name: input.connection_name ?? app.app_display_name,
      connection_status: 'pending_setup',
      provider_key: selected_profile.provider_key,
      provider_config_key: selected_profile.provider_config_key,
      provider_config_version: selected_profile.provider_config_version,
      connection_profile_key: selected_profile.connection_profile_key,
      connection_profile_version: selected_profile.connection_profile_version,
      auth_method_key: selected_profile.auth_method_key,
      external_user_key,
      authorized_scopes: selected_profile.default_scopes,
      health_status: 'unknown',
      connection_config:
        input.access_type === 'restricted' ? build_restricted_access_config(input.actor_id) : {},
      setup_state,
      ...(setup_credential_values(input)
        ? {
            credentials: encrypt_connection_credentials({
              credential_source: 'manual',
              values: setup_credential_values(input) ?? {},
            }),
          }
        : {}),
      provider_account: {},
      metadata: {},
      created_by: input.actor_id,
      last_updated_by: input.actor_id,
    })
    .returning();

  const connection = require_inserted_row(created_connection, 'Connection');
  if (input.access_type === 'restricted') {
    await restrict_connection_to_one_person(db, {
      workspace_id: input.workspace_id,
      connection_id,
      user_id: input.actor_id,
    });
  }
  return {
    connection: redact_connection(connection),
    setup: setup_state,
  };
}

export async function finalize_provider_connection(
  db: Database,
  input: FinalizeProviderConnectionInput,
) {
  return db.transaction(async (tx) => {
    const now = new Date();
    const connection = await get_workspace_connection(tx, {
      workspace_id: input.workspace_id,
      connection_id: input.connection_id,
    });
    if (!connection) throw new NotFoundError('Connection');
    if (connection.provider_key !== input.provider_key) {
      throw new ValidationError('Connection provider did not match webhook provider');
    }

    const [updated_row] = await tx
      .update(connections)
      .set(
        input.status === 'success'
          ? {
              connection_status: 'active',
              external_account_id: input.external_account_id ?? connection.external_account_id,
              external_account_name:
                input.external_account_name ?? connection.external_account_name,
              authorized_scopes: input.authorized_scopes ?? connection.authorized_scopes,
              provider_account: input.provider_account ?? connection.provider_account,
              health_status: 'healthy',
              connected_by: input.actor_id,
              connected_time: now,
              last_provider_update_time: now,
              setup_state: completed_connection_setup_state(connection.setup_state, {
                created_time: connection.created_time,
              }),
              credentials: null,
              last_updated_time: now,
              last_updated_by: input.actor_id,
            }
          : {
              connection_status: 'failed',
              health_status: 'unhealthy',
              setup_state: failed_connection_setup_state(
                connection.setup_state,
                input.error_message ?? 'Provider setup failed',
              ),
              last_provider_update_time: now,
              last_updated_time: now,
              last_updated_by: input.actor_id,
            },
      )
      .where(
        and(
          eq(connections.workspace_id, input.workspace_id),
          eq(connections.connection_id, input.connection_id),
        ),
      )
      .returning();

    const updated_connection = require_inserted_row(updated_row, 'Connection');
    await revoke_replaced_active_connections(tx, {
      connection: updated_connection,
      actor_id: input.actor_id,
      now,
    });
    return redact_connection(updated_connection);
  });
}

export async function finalize_oauth_connection(db: Database, input: FinalizeOAuthConnectionInput) {
  return db.transaction(async (tx) => {
    const now = new Date();
    const connection = await get_workspace_connection_by_oauth_state(tx, {
      workspace_id: input.workspace_id,
      state_token: input.state_token,
    });
    if (!connection) throw new NotFoundError('Connection');

    if (input.status === 'error') {
      return update_connection_state(tx, {
        workspace_id: input.workspace_id,
        connection_id: connection.connection_id,
        actor_id: input.actor_id,
        state: {
          connection_status: 'failed',
          health_status: 'unhealthy',
          setup_state: failed_connection_setup_state(
            connection.setup_state,
            input.error_message ?? 'OAuth setup failed',
          ),
          last_provider_update_time: now,
        },
      });
    }

    assert_oauth_state_is_current(connection.setup_state);
    const token_response = input.token_response ?? {};
    const scopes = authorized_scopes_from_token(token_response, connection.authorized_scopes);
    const [updated_row] = await tx
      .update(connections)
      .set({
        connection_status: 'active',
        external_account_id:
          find_external_account_id(token_response) ?? connection.external_account_id,
        external_account_name:
          find_external_account_name(token_response) ?? connection.external_account_name,
        authorized_scopes: scopes,
        provider_account: provider_account_without_tokens(token_response),
        credentials: replace_connection_credential_values({
          existing: connection.credentials,
          keeping_keys: credentials_outliving_authorization(connection.credentials),
          credential_source: 'oauth2',
          values: oauth_credential_values(token_response),
          metadata: {
            token_type: token_response.token_type ?? null,
            scope: scope_string_from_token(token_response),
          },
        }),
        credential_expiry_time: credential_expiry_time(now, token_response),
        health_status: 'healthy',
        connected_by: input.actor_id,
        connected_time: now,
        last_provider_update_time: now,
        setup_state: {},
        last_updated_time: now,
        last_updated_by: input.actor_id,
      })
      .where(
        and(
          eq(connections.workspace_id, input.workspace_id),
          eq(connections.connection_id, connection.connection_id),
        ),
      )
      .returning();

    const updated_connection = require_inserted_row(updated_row, 'Connection');
    await revoke_replaced_active_connections(tx, {
      connection: updated_connection,
      actor_id: input.actor_id,
      now,
    });
    return redact_connection(updated_connection);
  });
}

export async function get_pending_oauth_connection_setup(
  db: Database,
  input: { workspace_id?: string | undefined; state_token: string },
) {
  await expire_stale_pending_connection_setups(db, {
    ...(input.workspace_id ? { workspace_id: input.workspace_id } : {}),
  });

  const connection = await get_connection_by_oauth_state(db, input);
  if (!connection) throw new NotFoundError('Connection');
  await reject_expired_pending_connection_setup(db, { connection });
  assert_oauth_state_is_current(connection.setup_state);
  return {
    connection_id: connection.connection_id,
    workspace_id: connection.workspace_id,
    credentials: connection.credentials,
    provider_key: connection.provider_key,
    provider_config_key: connection.provider_config_key,
    setup_state: connection.setup_state,
    actor_id: connection.last_updated_by,
  };
}

export async function get_pending_provider_connection_setup(
  db: Database,
  input: { workspace_id?: string | undefined; connection_id: string; provider_key: string },
): Promise<PendingProviderConnectionSetup> {
  await expire_stale_pending_connection_setups(db, {
    ...(input.workspace_id ? { workspace_id: input.workspace_id } : {}),
  });

  const connection = await get_connection_by_id(db, input);
  if (!connection) throw new NotFoundError('Connection');
  if (connection.provider_key !== input.provider_key) {
    throw new ValidationError('Connection provider did not match setup provider');
  }
  if (connection.connection_status !== 'pending_setup') {
    throw new ValidationError('Connection is not pending setup');
  }
  await reject_expired_pending_connection_setup(db, { connection });

  return {
    connection_id: connection.connection_id,
    workspace_id: connection.workspace_id,
    provider_key: connection.provider_key,
    provider_config_key: connection.provider_config_key,
    setup_state: connection.setup_state,
    actor_id: connection.last_updated_by,
  };
}

export async function get_pending_connection_setup_by_setup_token(
  db: Database,
  input: { connection_id: string; setup_token: string },
): Promise<PendingConnectionSetupByToken> {
  const connection = await get_connection_by_id(db, {
    connection_id: input.connection_id,
  });
  if (!connection) throw new NotFoundError('Connection');
  if (connection.connection_status !== 'pending_setup') {
    throw new ValidationError('Connection is not pending setup');
  }

  await reject_expired_pending_connection_setup(db, { connection });
  const setup_token = connection.setup_state.setup_token;
  if (
    !setup_token ||
    !secure_strings_equal(presented_connection_setup_token(input.setup_token), setup_token)
  ) {
    throw new AppError('invalid_connection_setup_token', 'Invalid connection setup token', 401);
  }

  return {
    connection_id: connection.connection_id,
    workspace_id: connection.workspace_id,
    app_id: connection.app_id,
    provider_key: connection.provider_key,
    provider_config_key: connection.provider_config_key,
    setup_state: connection.setup_state,
    credentials: connection.credentials,
    actor_id: connection.last_updated_by,
  };
}

export async function get_completed_connection_setup_by_setup_token(
  db: Database,
  input: { connection_id: string; setup_token: string },
): Promise<CompletedConnectionSetupByToken | null> {
  // Why: a hosted provider can send the server webhook before the browser lands on /connect/callback.
  // The connection is already active then, but the browser still needs a token-authenticated
  // "yes, this setup finished" answer instead of a customer-visible error page.
  const connection = await get_connection_by_id(db, {
    connection_id: input.connection_id,
  });
  if (!connection) throw new NotFoundError('Connection');
  if (connection.connection_status !== 'active') return null;

  const setup_state = connection.setup_state;
  if (setup_state.type !== 'completed_connection_setup') return null;

  const setup_token_hash = setup_state.setup_token_hash;
  const expires_time = timestamp_ms(setup_state.setup_token_expires_time);
  if (
    !setup_token_hash ||
    !secure_strings_equal(
      hash_connection_setup_token(presented_connection_setup_token(input.setup_token)),
      setup_token_hash,
    )
  ) {
    throw new AppError('invalid_connection_setup_token', 'Invalid connection setup token', 401);
  }
  if (!expires_time || Date.now() > expires_time) {
    throw new ValidationError('Connection setup expired');
  }

  return {
    connection_id: connection.connection_id,
    connection_status: 'active',
    provider_key: connection.provider_key,
  };
}

export async function expire_stale_pending_connection_setups(
  db: Database,
  input: {
    workspace_id?: string | undefined;
    now?: Date;
    actor_id?: string;
    expiry_ms?: number;
    limit?: number;
  } = {},
) {
  const now = input.now ?? new Date();
  const expiry_ms = input.expiry_ms ?? pending_connection_setup_expiry_ms;
  const cutoff = new Date(now.getTime() - expiry_ms);
  const cutoff_time = cutoff.toISOString();
  const limit = Math.max(input.limit ?? 100, 1);
  const actor_id = input.actor_id ?? connection_setup_expiry_actor;

  return db.transaction(async (tx) => {
    const stale_connections = await tx
      .select({ connection_id: connections.connection_id, setup_state: connections.setup_state })
      .from(connections)
      .where(
        and(
          eq(connections.connection_status, 'pending_setup'),
          lte(connections.created_time, cutoff),
          sql`coalesce(nullif(${connections.setup_state}->>'setup_started_time', '')::timestamptz, ${connections.created_time}) <= ${cutoff_time}::timestamptz`,
          ...(input.workspace_id ? [eq(connections.workspace_id, input.workspace_id)] : []),
        ),
      )
      .orderBy(asc(connections.created_time))
      .limit(limit);
    if (stale_connections.length === 0) return [];

    const setup_state_before_expiry = new Map(
      stale_connections.map((connection) => [connection.connection_id, connection.setup_state]),
    );
    const expired = await tx
      .update(connections)
      .set(expired_pending_connection_setup_state(now, actor_id))
      .where(
        inArray(
          connections.connection_id,
          stale_connections.map((connection) => connection.connection_id),
        ),
      )
      .returning();

    return expired.map((connection) => ({
      ...connection,
      setup_state_before_expiry: setup_state_before_expiry.get(connection.connection_id) ?? {},
    }));
  });
}

async function reject_expired_pending_connection_setup(
  db: Database,
  input: {
    connection: typeof connections.$inferSelect;
    now?: Date;
    actor_id?: string;
    expiry_ms?: number;
  },
) {
  const now = input.now ?? new Date();
  const expiry_ms = input.expiry_ms ?? pending_connection_setup_expiry_ms;
  const setup_started_time = read_pending_setup_started_time(input.connection);
  if (now.getTime() - setup_started_time.getTime() < expiry_ms) return;

  await expire_pending_connection_setup(db, {
    connection_id: input.connection.connection_id,
    now,
    actor_id: input.actor_id ?? connection_setup_expiry_actor,
  });
  throw new ValidationError('Connection setup expired');
}

async function expire_pending_connection_setup(
  db: Database,
  input: { connection_id: string; now: Date; actor_id: string },
) {
  await db
    .update(connections)
    .set(expired_pending_connection_setup_state(input.now, input.actor_id))
    .where(
      and(
        eq(connections.connection_id, input.connection_id),
        eq(connections.connection_status, 'pending_setup'),
      ),
    );
}

export async function cancel_pending_connection_setup(
  db: Database,
  input: { workspace_id: string; connection_id: string; actor_id: string; now?: Date },
): Promise<{ cancelled: boolean; setup_state_before_cancel?: ConnectionSetupStateData }> {
  const now = input.now ?? new Date();
  const is_this_pending_setup = and(
    eq(connections.workspace_id, input.workspace_id),
    eq(connections.connection_id, input.connection_id),
    eq(connections.connection_status, 'pending_setup'),
  );

  return db.transaction(async (tx) => {
    const [pending] = await tx
      .select({ setup_state: connections.setup_state })
      .from(connections)
      .where(is_this_pending_setup)
      .limit(1);
    if (!pending) return { cancelled: false };

    await tx
      .update(connections)
      .set(expired_pending_connection_setup_state(now, input.actor_id, 'cancelled_by_user'))
      .where(is_this_pending_setup);

    return { cancelled: true, setup_state_before_cancel: pending.setup_state };
  });
}

async function revoke_replaced_active_connections(
  db: DatabaseExecutor,
  input: {
    connection: typeof connections.$inferSelect;
    actor_id: string;
    now: Date;
  },
) {
  if (input.connection.connection_status !== 'active' || !input.connection.external_account_id) {
    return [];
  }

  return db
    .update(connections)
    .set({
      connection_status: 'revoked',
      health_status: 'unhealthy',
      revoked_time: input.now,
      connection_config: sql`${connections.connection_config} || ${JSON.stringify({
        superseded_by_connection_id: input.connection.connection_id,
        superseded_time: input.now.toISOString(),
      })}::jsonb`,
      last_updated_time: input.now,
      last_updated_by: input.actor_id,
    })
    .where(
      and(
        eq(connections.workspace_id, input.connection.workspace_id),
        eq(connections.app_id, input.connection.app_id),
        eq(connections.external_account_id, input.connection.external_account_id),
        eq(connections.connection_status, 'active'),
        ne(connections.connection_id, input.connection.connection_id),
      ),
    )
    .returning();
}

function expired_pending_connection_setup_state(
  now: Date,
  actor_id: string,
  reason: 'setup_timed_out' | 'cancelled_by_user' = 'setup_timed_out',
) {
  return {
    connection_status: 'expired',
    health_status: 'unhealthy',
    setup_state: {
      expired_reason: reason,
      expired_time: now.toISOString(),
    },
    last_provider_update_time: now,
    last_updated_time: now,
    last_updated_by: actor_id,
  } satisfies Partial<typeof connections.$inferInsert>;
}

export async function mark_connection_credential_rejected(
  db: Database,
  input: {
    workspace_id: string;
    connection_id: string;
    actor_id: string;
    rejection_detail: string;
  },
) {
  const now = new Date();
  return update_connection_state(db, {
    workspace_id: input.workspace_id,
    connection_id: input.connection_id,
    actor_id: input.actor_id,
    state: {
      health_status: 'unhealthy',
      last_checked_time: now,
      connection_config: sql`${connections.connection_config} || ${JSON.stringify({
        credential_rejected_time: now.toISOString(),
        credential_rejected_detail: input.rejection_detail.slice(0, 500),
      })}::jsonb`,
    },
  });
}

export async function revoke_connection(
  db: Database,
  input: { workspace_id: string; connection_id: string; actor_id: string },
) {
  return update_connection_state(db, {
    ...input,
    state: {
      connection_status: 'revoked',
      health_status: 'unhealthy',
      revoked_time: new Date(),
    },
  });
}

export async function reconnect_connection(
  db: Database,
  input: {
    workspace_id: string;
    connection_id: string;
    redirect_uri?: string | undefined;
    actor_id: string;
  },
) {
  const connection = await get_workspace_connection(db, input);
  if (!connection) throw new NotFoundError('Connection');
  if (
    connection.connection_status === 'pending_setup' &&
    pending_connection_setup_is_current(connection)
  ) {
    return redact_connection(connection);
  }
  const reconnect_profile = await find_reconnect_setup_profile(db, connection);

  const setup_state = add_missing_setup_token_to_setup_state(
    build_setup_state({
      connection_id: connection.connection_id,
      external_user_key: connection.external_user_key ?? `ws_${connection.workspace_id}`,
      provider_key: connection.provider_key,
      ...(reconnect_profile?.provider_app_key
        ? { provider_app_key: reconnect_profile.provider_app_key }
        : {}),
      ...(input.redirect_uri ? { redirect_uri: input.redirect_uri } : {}),
      setup_strategy: reconnect_profile?.setup_strategy ?? { type: 'manual' },
      default_scopes: reconnect_profile?.default_scopes ?? connection.authorized_scopes,
    }),
  );

  return update_connection_state(db, {
    ...input,
    state: {
      connection_status: 'pending_setup',
      health_status: 'unknown',
      setup_state,
      revoked_time: null,
    },
  });
}

export async function patch_connection(
  db: Database,
  input: {
    workspace_id: string;
    connection_id: string;
    connection_name?: string | undefined;
    connection_config?: Record<string, unknown> | undefined;
    access_type?: ConnectionAccessType | undefined;
    actor_id: string;
  },
) {
  await apply_access_type_to_people(db, input);
  return update_connection_state(db, {
    ...input,
    state: {
      ...(input.connection_name === undefined ? {} : { connection_name: input.connection_name }),
      ...access_type_config_patch(input.actor_id, input.access_type),
      ...(input.access_type !== undefined || input.connection_config === undefined
        ? {}
        : { connection_config: input.connection_config }),
    },
  });
}

async function apply_access_type_to_people(
  db: Database,
  input: {
    workspace_id: string;
    connection_id: string;
    access_type?: ConnectionAccessType | undefined;
    actor_id: string;
  },
) {
  if (input.access_type === 'restricted') {
    await restrict_connection_to_one_person(db, {
      workspace_id: input.workspace_id,
      connection_id: input.connection_id,
      user_id: input.actor_id,
    });
  }
  if (input.access_type === 'shared') {
    await open_connection_to_everyone(db, {
      workspace_id: input.workspace_id,
      connection_id: input.connection_id,
    });
  }
}

function access_type_config_patch(actor_id: string, access_type?: ConnectionAccessType) {
  if (access_type === 'restricted') {
    return {
      connection_config: sql`${connections.connection_config} || ${JSON.stringify(
        build_restricted_access_config(actor_id),
      )}::jsonb`,
    };
  }
  if (access_type === 'shared') {
    return {
      connection_config: sql`${connections.connection_config} - 'connection_access_type' - 'access'`,
    };
  }
  return {};
}

export async function list_agent_enabled_nodes(
  db: Database,
  input: { workspace_id: string; agent_id: string },
) {
  const agent = await get_workspace_agent(db, input);
  if (!agent) throw new NotFoundError('Agent');
  return parse_agent_enabled_nodes(agent.agent_config);
}

export async function update_agent_enabled_nodes(
  db: Database,
  input: {
    workspace_id: string;
    agent_id: string;
    enabled_nodes: AgentEnabledNode[];
    actor_id: string;
  },
) {
  const agent = await get_workspace_agent(db, input);
  if (!agent) throw new NotFoundError('Agent');
  const next_config = write_agent_enabled_nodes(agent.agent_config, input.enabled_nodes);
  const [updated_agent] = await db
    .update(agents)
    .set({
      agent_config: next_config,
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(and(eq(agents.workspace_id, input.workspace_id), eq(agents.agent_id, input.agent_id)))
    .returning();
  return parse_agent_enabled_nodes(require_inserted_row(updated_agent, 'Agent').agent_config);
}

async function get_workspace_connection(
  db: DatabaseExecutor,
  input: { workspace_id: string; connection_id: string },
) {
  return get_connection_by_id(db, input);
}

async function get_connection_by_id(
  db: DatabaseExecutor,
  input: { workspace_id?: string | undefined; connection_id: string },
) {
  const filters = [eq(connections.connection_id, input.connection_id)];
  if (input.workspace_id) filters.unshift(eq(connections.workspace_id, input.workspace_id));

  return (await db.query.connections.findFirst({ where: and(...filters) })) ?? null;
}

async function get_workspace_agent(
  db: Database,
  input: { workspace_id: string; agent_id: string },
) {
  return (
    (await db.query.agents.findFirst({
      where: and(eq(agents.workspace_id, input.workspace_id), eq(agents.agent_id, input.agent_id)),
    })) ?? null
  );
}

export async function get_visible_workspace_app(
  db: Database,
  workspace_id: string,
  app_id: string,
) {
  return (
    (await db.query.apps.findFirst({
      where: and(
        eq(apps.app_id, app_id),
        or(
          and(eq(apps.catalog_scope, 'global'), isNull(apps.workspace_id)),
          and(eq(apps.catalog_scope, 'workspace'), eq(apps.workspace_id, workspace_id)),
        ),
      ),
    })) ?? null
  );
}

async function update_connection_state(
  db: DatabaseExecutor,
  input: {
    workspace_id: string;
    connection_id: string;
    actor_id: string;
    state: PgUpdateSetSource<typeof connections>;
  },
) {
  const [updated_connection] = await db
    .update(connections)
    .set({
      ...input.state,
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(
      and(
        eq(connections.workspace_id, input.workspace_id),
        eq(connections.connection_id, input.connection_id),
      ),
    )
    .returning();

  if (!updated_connection) throw new NotFoundError('Connection');
  return redact_connection(updated_connection);
}

function find_connection_setup_profile(
  app: typeof apps.$inferSelect,
  input: CreateConnectionInput,
): ConnectionSetupProfile {
  const provider_configs = parse_app_provider_configs(app.metadata);
  const provider_config = find_active_provider_config(provider_configs, input);

  if (provider_config) {
    const profile = find_active_connection_profile(provider_config, input);
    if (!profile) throw new ValidationError('No active connection profile matched the request');
    return {
      provider_key: provider_config.provider_key,
      provider_config_key: provider_config.provider_config_key,
      provider_config_version: provider_config.version,
      ...(provider_config.provider_app_key
        ? { provider_app_key: provider_config.provider_app_key }
        : {}),
      connection_profile_key: profile.connection_profile_key,
      connection_profile_version: profile.version,
      auth_method_key: profile.auth_method_key,
      setup_strategy: profile.setup_strategy,
      default_scopes: profile.default_scopes,
    };
  }

  return create_legacy_profile(app, input);
}

function create_legacy_profile(
  app: typeof apps.$inferSelect,
  input: CreateConnectionInput,
): ConnectionSetupProfile {
  const provider_key = input.provider_key ?? app.metadata.source ?? 'native';
  const provider_config_key = input.provider_config_key ?? `${provider_key}:${app.app_name}`;
  const connection_profile_key =
    input.connection_profile_key ?? `${provider_key}:${app.app_name}:default`;

  return {
    provider_key,
    provider_config_key,
    provider_config_version: 1,
    provider_app_key: app.app_name,
    connection_profile_key,
    connection_profile_version: 1,
    ...(legacy_provider_profiles[provider_key] ?? default_legacy_provider_profile),
    default_scopes: [] as string[],
  };
}

const legacy_provider_profiles: Record<
  string,
  { auth_method_key: string; setup_strategy: Record<string, unknown> }
> = {};

const default_legacy_provider_profile = {
  auth_method_key: 'none',
  setup_strategy: { type: 'manual' },
};

function build_setup_state(input: {
  connection_id: string;
  external_user_key: string;
  provider_key: string;
  provider_app_key?: string;
  redirect_uri?: string;
  setup_strategy: Record<string, unknown>;
  default_scopes: string[];
}) {
  const setup_started_time = new Date().toISOString();
  if (is_oauth_setup_strategy(input.setup_strategy)) {
    return {
      ...build_oauth_setup_state({
        connection_id: input.connection_id,
        external_user_key: input.external_user_key,
        ...(input.provider_app_key ? { provider_app_key: input.provider_app_key } : {}),
        ...(input.redirect_uri ? { redirect_uri: input.redirect_uri } : {}),
        setup_strategy: input.setup_strategy,
        default_scopes: input.default_scopes,
      }),
      setup_started_time,
    };
  }

  const hosted = is_hosted_setup_strategy(input.setup_strategy);
  return {
    type: hosted ? String(input.setup_strategy.type) : 'manual',
    connection_id: input.connection_id,
    provider_key: input.provider_key,
    external_user_key: input.external_user_key,
    provider_app_key: input.provider_app_key ?? null,
    ...(hosted
      ? {
          provider_webhook_token: create_connection_setup_token(),
          setup_strategy: input.setup_strategy,
        }
      : {}),
    redirect_uri: input.redirect_uri ?? null,
    hosted_connect_link: null,
    setup_started_time,
  };
}

export async function set_connection_resume_intent(
  db: Database,
  input: {
    workspace_id: string;
    connection_id: string;
    resume: ConnectionResumeIntentData;
    actor_id: string;
  },
) {
  await db
    .update(connections)
    .set({
      setup_state: sql`${connections.setup_state} || ${JSON.stringify({ resume: input.resume })}::jsonb`,
      ...updated_by(input.actor_id),
    })
    .where(
      and(
        eq(connections.workspace_id, input.workspace_id),
        eq(connections.connection_id, input.connection_id),
      ),
    );
}

export async function merge_pending_connection_setup_state(
  db: Database,
  input: {
    workspace_id?: string | undefined;
    connection_id: string;
    patch: Record<string, unknown>;
  },
) {
  await db
    .update(connections)
    .set({
      setup_state: sql`${connections.setup_state} || ${JSON.stringify(input.patch)}::jsonb`,
      ...updated_by(connections.last_updated_by),
    })
    .where(
      and(
        eq(connections.connection_id, input.connection_id),
        eq(connections.connection_status, 'pending_setup'),
        ...(input.workspace_id ? [eq(connections.workspace_id, input.workspace_id)] : []),
      ),
    );
}

function add_resume_to_setup_state(
  setup_state: ConnectionSetupStateData,
  resume?: ConnectionResumeIntentData,
) {
  if (!resume) return setup_state;
  return { ...setup_state, resume };
}

function add_missing_setup_token_to_setup_state(setup_state: ConnectionSetupStateData) {
  if (setup_state.setup_token) return setup_state;
  return { ...setup_state, setup_token: create_connection_setup_token() };
}

function add_setup_started_time_to_setup_state(setup_state: ConnectionSetupStateData) {
  return { ...setup_state, setup_started_time: new Date().toISOString() };
}

function add_setup_session_id_to_setup_state(
  setup_state: ConnectionSetupStateData,
  setup_session_id?: string | null,
) {
  if (!setup_session_id) return setup_state;
  return { ...setup_state, setup_session_id };
}

function completed_connection_setup_state(
  setup_state: ConnectionSetupStateData,
  input: { created_time: Date },
) {
  const setup_token = setup_state.setup_token;
  if (!setup_token) return {};
  const setup_started_time = read_setup_started_time(setup_state) ?? input.created_time;

  return {
    type: 'completed_connection_setup',
    setup_token_hash: hash_connection_setup_token(setup_token),
    setup_token_expires_time: new Date(
      setup_started_time.getTime() + pending_connection_setup_expiry_ms,
    ).toISOString(),
  };
}

function failed_connection_setup_state(
  setup_state: ConnectionSetupStateData,
  error_message: string,
) {
  const setup_token = setup_state.setup_token;
  return {
    type: 'failed_connection_setup',
    error_message,
    ...(setup_token ? { setup_token_hash: hash_connection_setup_token(setup_token) } : {}),
  };
}

export async function get_failed_connection_setup_by_setup_token(
  db: Database,
  input: { connection_id: string; setup_token: string },
): Promise<{ connection_id: string; error_message: string } | null> {
  const connection = await get_connection_by_id(db, { connection_id: input.connection_id });
  if (!connection) throw new NotFoundError('Connection');
  if (connection.connection_status !== 'failed') return null;

  const setup_state = connection.setup_state;
  const setup_token_hash = setup_state.setup_token_hash;
  if (!setup_token_hash) return null;
  if (
    !secure_strings_equal(
      hash_connection_setup_token(presented_connection_setup_token(input.setup_token)),
      setup_token_hash,
    )
  ) {
    throw new AppError('invalid_connection_setup_token', 'Invalid connection setup token', 401);
  }

  return {
    connection_id: connection.connection_id,
    error_message: setup_state.error_message ?? 'Connection setup failed.',
  };
}

async function find_reusable_pending_connection_setup(
  db: Database,
  input: {
    workspace_id: string;
    app_id: string;
    actor_id: string;
    profile: ConnectionSetupProfile;
    resume_session_id?: string | undefined;
    resume_actor_id?: string | undefined;
    setup_session_id?: string | undefined;
    connection_name?: string | undefined;
  },
) {
  const resume_filters = reusable_pending_setup_resume_filters(input);
  if (resume_filters.length === 0) return null;

  const [connection] = await db
    .select()
    .from(connections)
    .where(
      and(
        eq(connections.workspace_id, input.workspace_id),
        eq(connections.app_id, input.app_id),
        eq(connections.connection_status, 'pending_setup'),
        eq(connections.provider_key, input.profile.provider_key),
        eq(connections.provider_config_key, input.profile.provider_config_key),
        eq(connections.connection_profile_key, input.profile.connection_profile_key),
        ...resume_filters,
      ),
    )
    .orderBy(desc(connections.created_time))
    .limit(1);

  return connection ?? null;
}

function reusable_pending_setup_resume_filters(input: {
  actor_id: string;
  resume_session_id?: string | undefined;
  resume_actor_id?: string | undefined;
  setup_session_id?: string | undefined;
  connection_name?: string | undefined;
}) {
  if (input.resume_session_id) {
    return input.resume_actor_id
      ? [sql`${connections.setup_state}->'resume'->>'actor_id' = ${input.resume_actor_id}`]
      : [
          eq(connections.created_by, input.actor_id),
          sql`${connections.setup_state}->'resume'->>'session_id' = ${input.resume_session_id}`,
        ];
  }
  if (input.connection_name || !input.setup_session_id) return [];

  return [
    eq(connections.created_by, input.actor_id),
    sql`${connections.setup_state}->>'setup_session_id' = ${input.setup_session_id}`,
    sql`${connections.setup_state}->'resume' IS NULL`,
  ];
}

function read_resume_session_id(resume?: Record<string, unknown>) {
  return typeof resume?.session_id === 'string' && resume.session_id ? resume.session_id : null;
}

function read_resume_actor_id(resume?: Record<string, unknown>) {
  return typeof resume?.actor_id === 'string' && resume.actor_id ? resume.actor_id : null;
}

function create_connection_setup_token() {
  return randomBytes(32).toString('base64url');
}

// Setup tokens end connect URLs that travel through chat messages, and linkifiers and copy-paste
// love to glue the next word onto a URL ("...Twk" + "The" -> 401 for the customer). The token has
// a fixed length, so anything past it is glue, never secret material — drop it instead of failing
// the whole connect flow.
const connection_setup_token_length = create_connection_setup_token().length;

function presented_connection_setup_token(setup_token: string) {
  return setup_token.slice(0, connection_setup_token_length);
}

function hash_connection_setup_token(setup_token: string) {
  return createHash('sha256').update(setup_token).digest('base64url');
}

function timestamp_ms(value: string | Date | undefined) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function read_pending_setup_started_time(connection: typeof connections.$inferSelect) {
  return read_setup_started_time(connection.setup_state) ?? connection.created_time;
}

function pending_connection_setup_is_current(connection: typeof connections.$inferSelect) {
  const setup_started_time = read_pending_setup_started_time(connection);
  return Date.now() - setup_started_time.getTime() < pending_connection_setup_expiry_ms;
}

function read_setup_started_time(setup_state: ConnectionSetupStateData) {
  const time = timestamp_ms(setup_state.setup_started_time);
  return time === null ? null : new Date(time);
}

async function find_reconnect_setup_profile(
  db: Database,
  connection: typeof connections.$inferSelect,
) {
  const app = await get_visible_workspace_app(db, connection.workspace_id, connection.app_id);
  if (!app) return null;

  return find_connection_setup_profile(app, {
    workspace_id: connection.workspace_id,
    app_id: connection.app_id,
    ...(connection.provider_key ? { provider_key: connection.provider_key } : {}),
    ...(connection.provider_config_key
      ? { provider_config_key: connection.provider_config_key }
      : {}),
    ...(connection.connection_profile_key
      ? { connection_profile_key: connection.connection_profile_key }
      : {}),
    actor_id: connection.last_updated_by,
  });
}

async function get_workspace_connection_by_oauth_state(
  db: DatabaseExecutor,
  input: { workspace_id: string; state_token: string },
) {
  return get_connection_by_oauth_state(db, input);
}

async function get_connection_by_oauth_state(
  db: DatabaseExecutor,
  input: { workspace_id?: string | undefined; state_token: string },
) {
  const filters = [
    eq(connections.connection_status, 'pending_setup'),
    sql`${connections.setup_state}->>'oauth_state_token' = ${input.state_token}`,
  ];
  if (input.workspace_id) filters.unshift(eq(connections.workspace_id, input.workspace_id));

  return (
    (await db.query.connections.findFirst({
      where: and(...filters),
    })) ?? null
  );
}

function assert_oauth_state_is_current(setup_state: ConnectionSetupStateData) {
  const expires_time = setup_state.oauth_state_expires_time;
  if (!expires_time || new Date(expires_time).getTime() <= Date.now()) {
    throw new AppError('oauth_state_expired', 'OAuth setup state expired.', 422);
  }
}

function oauth_credential_values(token_response: OAuthTokenResponseData) {
  return {
    access_token: token_response.access_token,
    refresh_token: token_response.refresh_token,
    id_token: token_response.id_token,
    bot_token: token_response.bot_access_token,
  };
}

function provider_account_without_tokens(token_response: OAuthTokenResponseData) {
  return remove_sensitive_keys(token_response);
}

function remove_sensitive_keys(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => !is_sensitive_key(key))
      .map(([key, child]) => [
        key,
        Array.isArray(child) ? child : remove_nested_sensitive_keys(child),
      ]),
  );
}

function remove_nested_sensitive_keys(value: unknown): unknown {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? remove_sensitive_keys(value)
    : value;
}

function is_sensitive_key(key: string) {
  const normalized_key = key.toLowerCase();
  return (
    normalized_key.includes('token') ||
    normalized_key.includes('secret') ||
    normalized_key.includes('password')
  );
}

function authorized_scopes_from_token(token_response: OAuthTokenResponseData, fallback: string[]) {
  const scope = scope_string_from_token(token_response);
  if (scope) return split_scope_string(scope);
  return fallback;
}

function scope_string_from_token(token_response: OAuthTokenResponseData) {
  return token_response.scope ?? token_response.scopes;
}

function split_scope_string(scope: string) {
  return scope.split(/[,\s]+/u).filter(Boolean);
}

function credential_expiry_time(now: Date, token_response: OAuthTokenResponseData) {
  const expires_in = token_response.expires_in;
  return expires_in ? new Date(now.getTime() + expires_in * 1000) : null;
}

// An OAuth token response names the connected account differently per provider: Slack
// sends the id under `team_id` (or a nested `team.id`, or `authed_user.id`), while other
// providers send `account_id`. The precedence chain lives once, next to the boundary parse.

export function find_external_account_id(token_response: OAuthTokenResponseData) {
  return (
    token_response.account_id ??
    token_response.team_id ??
    token_response.team?.id ??
    token_response.authed_user?.id ??
    null
  );
}

function find_external_account_name(token_response: OAuthTokenResponseData) {
  return (
    token_response.account_name ?? token_response.team_name ?? token_response.team?.name ?? null
  );
}
