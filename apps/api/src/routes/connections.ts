import type { ApiEnv } from '@api/lib/context';
import { ok } from '@api/lib/response';
import { validate_json, validate_query } from '@api/lib/validate';
import { start_listen_ears_for_connection } from '@api/services/automations/listen_ears';
import { refuse_app_that_cannot_connect_here } from '@api/services/connections/app_this_install_can_connect';
import { get_connection_for_user } from '@api/services/connections/connection_reader_service';
import {
  add_connection_access_member,
  check_connection_health_as_user,
  get_connection_managed_by_user,
  list_connections_for_user,
  patch_connection_as_user,
  remove_connection_access_member,
  revoke_connection_as_user,
} from '@api/services/connections/connection_service';
import { list_connection_tools_for_user } from '@api/services/connections/connection_tools_service';
import { reconnect_connection_for_user } from '@api/services/connections/mcp_server_reconnect';
import { create_workspace_scout_trigger } from '@api/services/scout/scout_provisioning';
import type { Database } from '@coworker/core';
import { is_unique_violation_of } from '@coworker/core/db/database_error';
import {
  cancel_pending_connection_setup,
  finalize_oauth_connection,
  find_external_account_id,
  get_completed_connection_setup_by_setup_token,
  get_failed_connection_setup_by_setup_token,
  get_pending_connection_setup_by_setup_token,
  get_pending_oauth_connection_setup,
  get_pending_provider_connection_setup,
  get_redacted_connection,
} from '@coworker/core/db/queries/connection_management';
import { postpone_pending_connection_resume } from '@coworker/core/db/queries/connection_resume_state';
import type {
  AppDisplayConfigData,
  AppMetadataData,
  ConnectionSetupStateData,
} from '@coworker/core/db/schema/json_column_types';
import {
  claim_external_account_for_connection,
  finalize_oauth_connection_with_resume,
  finalize_provider_connection_with_resume,
  probe_slack_connection_liveness,
  start_connection_resume,
  upsert_default_slack_channel_for_connection,
} from '@coworker/runtime-platform';
import { AppError, format_error_message, NotFoundError, ValidationError } from '@coworker/shared';
import { secure_strings_equal } from '@coworker/shared/secure_strings_equal';
import {
  find_connection_provider_adapter,
  type HostedConnectionProviderAdapter,
} from '@runtime-platform/connections/connection_provider_adapters';
import { allowed_return_origins } from '@runtime-platform/connections/connection_return_uri';
import type { ProviderConnectionCompletion } from '@runtime-platform/connections/connection_setup_contract';
import { create_connection_setup_for_a_person } from '@runtime-platform/connections/connection_setup_for_a_person';
import { build_connection_start_url } from '@runtime-platform/connections/connection_start_link';
import {
  build_public_connection_setup,
  exchange_oauth_code_for_tokens,
  type PublicConnectionSetup,
  redact_connection_setup_state,
} from '@runtime-platform/connections/oauth_connection_setup';
import { type Context, Hono } from 'hono';
import { z } from 'zod';

const create_connection_schema = z.object({
  app_id: z.string().min(1),
  provider_key: z.string().min(1).optional(),
  provider_config_key: z.string().min(1).optional(),
  connection_profile_key: z.string().min(1).optional(),
  connection_name: z.string().min(1).max(160).optional(),
  access_type: z.enum(['shared', 'restricted']).optional(),
  redirect_uri: z.string().url().optional(),
});

const patch_connection_schema = z
  .object({
    connection_name: z.string().trim().min(1).max(160).optional(),
    access_type: z.enum(['shared', 'restricted']).optional(),
  })
  .strict();

const add_access_member_schema = z
  .object({
    user_id: z.string().min(1).max(200),
    can_delete: z.boolean().optional(),
    can_edit_tools: z.boolean().optional(),
  })
  .strict();

const reconnect_connection_schema = z.object({
  redirect_uri: z.string().url().optional(),
});

const provider_webhook_query_schema = z.object({
  connection_id: z.string().min(1),
  provider_webhook_token: z.string().min(1).optional(),
});

const setup_start_query_schema = z.object({
  connection_id: z.string().min(1),
  setup_token: z.string().min(1),
});

const provider_webhook_body_schema = z.looseObject({});

type PublicAppFields = { description?: string; icon_url?: string };

export const public_connection_routes = new Hono<ApiEnv>()
  .get('/v1/connections/setup/start', validate_query(setup_start_query_schema), async (c) => {
    const query = c.req.valid('query');
    const setup = await get_pending_connection_setup_by_setup_token(c.get('db'), query);
    const redirect_uri = connection_setup_redirect_uri(setup.setup_state);
    const provider_setup = await build_public_connection_setup({
      provider_key: setup.provider_key,
      setup_state: setup.setup_state,
      credentials: setup.credentials,
      db: c.get('db'),
      ...(redirect_uri ? { redirect_uri } : {}),
      request_origin: c.req.header('origin'),
    });
    const setup_url = connection_setup_url(provider_setup);
    if (!setup_url) {
      throw new AppError(
        'connection_setup_unavailable',
        connection_setup_error(provider_setup) ??
          'The provider did not return a connection setup URL.',
        422,
      );
    }

    const connection = await get_redacted_connection(c.get('db'), {
      workspace_id: setup.workspace_id,
      connection_id: setup.connection_id,
    });
    const app = connection?.app ? public_connection_setup_app(connection.app) : null;

    return c.json(
      ok({
        connection_id: setup.connection_id,
        setup_url,
        ...(app ? { app } : {}),
      }),
    );
  })
  .post('/v1/connections/setup/complete', validate_query(setup_start_query_schema), async (c) => {
    const query = c.req.valid('query');
    const already_completed = await get_completed_connection_setup_by_setup_token(
      c.get('db'),
      query,
    );
    if (already_completed) return c.json(ok(already_completed));

    const already_failed = await get_failed_connection_setup_by_setup_token(c.get('db'), query);
    if (already_failed) {
      throw new AppError('connection_setup_failed', already_failed.error_message, 409);
    }

    const setup = await get_pending_connection_setup_by_setup_token(c.get('db'), query);
    const completion = await require_connection_provider_adapter(setup.provider_key).complete_setup(
      { setup_state: setup.setup_state },
    );
    const connection = await finalize_completed_provider_connection(c.get('db'), {
      workspace_id: setup.workspace_id,
      connection_id: setup.connection_id,
      provider_key: setup.provider_key,
      actor_id: setup.actor_id,
      setup_state: setup.setup_state,
      completion,
    });

    return c.json(ok(connection));
  })
  .post(
    '/v1/connections/providers/:provider_key/webhook',
    validate_query(provider_webhook_query_schema),
    validate_json(provider_webhook_body_schema),
    async (c) => {
      const provider_key = c.req.param('provider_key');
      const adapter = find_connection_provider_adapter(provider_key);
      if (!adapter) {
        throw new ValidationError('Provider webhook is not supported for this provider');
      }

      const query = c.req.valid('query');
      const setup = await get_pending_provider_connection_setup(c.get('db'), {
        provider_key,
        connection_id: query.connection_id,
      });
      if (query.provider_webhook_token) {
        verify_provider_webhook_token(adapter, query.provider_webhook_token, setup.setup_state);
      }

      const webhook_payload = c.req.valid('json');
      const completion = await adapter.complete_setup({
        setup_state: setup.setup_state,
        webhook_payload,
      });
      const connection = await finalize_completed_provider_connection(c.get('db'), {
        provider_key,
        connection_id: setup.connection_id,
        workspace_id: setup.workspace_id,
        actor_id: setup.actor_id,
        setup_state: setup.setup_state,
        completion,
      });

      return c.json(ok(connection));
    },
  )
  .get('/v1/connections/oauth/callback', complete_oauth_callback);

export const connection_routes = new Hono<ApiEnv>()
  .get('/v1/connections', async (c) => {
    return c.json(
      ok(
        await list_connections_for_user(c.get('db'), {
          workspace_id: c.get('workspace_id'),
          acting_user_id: c.get('user_id'),
        }),
      ),
    );
  })
  .post('/v1/connections', validate_json(create_connection_schema), async (c) => {
    const body = c.req.valid('json');
    await refuse_app_that_cannot_connect_here(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      app_id: body.app_id,
    });
    refuse_redirect_uri_outside_allowed_origins(body.redirect_uri);
    const result = await create_connection_setup_for_a_person(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      actor_id: c.get('user_id'),
      ...body,
    });
    return c.json(ok({ ...result, ...public_connection_setup_start(result) }), 201);
  })
  .get('/v1/connections/:connection_id', async (c) => {
    const connection = await get_connection_for_user(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      connection_id: c.req.param('connection_id'),
      acting_user_id: c.get('user_id'),
    });
    return c.json(ok(connection));
  })
  .get('/v1/connections/:connection_id/tools', async (c) => {
    return c.json(
      ok(
        await list_connection_tools_for_user(c.get('db'), {
          workspace_id: c.get('workspace_id'),
          connection_id: c.req.param('connection_id'),
          acting_user_id: c.get('user_id'),
        }),
      ),
    );
  })
  .post('/v1/connections/:connection_id/check', async (c) => {
    return c.json(
      ok(
        await check_connection_health_as_user(c.get('db'), {
          workspace_id: c.get('workspace_id'),
          connection_id: c.req.param('connection_id'),
          acting_user_id: c.get('user_id'),
          actor_id: c.get('user_id'),
        }),
      ),
    );
  })
  .post('/v1/connections/:connection_id/complete', async (c) => {
    const connection_id = c.req.param('connection_id');
    const existing_connection = await get_connection_managed_by_user(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      connection_id,
      acting_user_id: c.get('user_id'),
      actor_id: c.get('user_id'),
    });
    if (existing_connection.connection_status !== 'pending_setup') {
      return c.json(ok(existing_connection));
    }
    const requested_provider_key = c.req.query('provider_key');
    const adapter = require_connection_provider_adapter(existing_connection.provider_key);
    if (requested_provider_key && requested_provider_key !== adapter.provider_key) {
      throw new ValidationError('Connection provider did not match setup provider');
    }

    const setup = await get_pending_provider_connection_setup(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      connection_id,
      provider_key: adapter.provider_key,
    });
    const completion = await adapter.complete_setup({ setup_state: setup.setup_state });
    const connection = await finalize_completed_provider_connection(c.get('db'), {
      workspace_id: setup.workspace_id,
      connection_id: setup.connection_id,
      provider_key: setup.provider_key,
      actor_id: c.get('user_id'),
      setup_state: setup.setup_state,
      completion,
    });

    return c.json(ok(connection));
  })
  .post('/v1/connections/:connection_id/cancel-setup', async (c) => {
    const connection_id = c.req.param('connection_id');
    const result = await cancel_pending_connection_setup(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      connection_id,
      actor_id: c.get('user_id'),
    });
    if (result.cancelled && result.setup_state_before_cancel) {
      await start_connection_resume(c.get('db'), {
        workspace_id: c.get('workspace_id'),
        connection_id,
        actor_id: c.get('user_id'),
        setup_state: result.setup_state_before_cancel,
        resolution: 'cancelled',
      });
    }
    return c.json(ok(result));
  })
  .post('/v1/connections/:connection_id/postpone-setup', async (c) => {
    const connection_id = c.req.param('connection_id');
    const result = await postpone_pending_connection_resume(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      connection_id,
      actor_id: c.get('user_id'),
    });
    if (result.postponed && result.setup_state) {
      await start_connection_resume(c.get('db'), {
        workspace_id: c.get('workspace_id'),
        connection_id,
        actor_id: c.get('user_id'),
        setup_state: result.setup_state,
        resolution: 'postponed',
      });
    }
    return c.json(ok({ postponed: result.postponed }));
  })
  .post('/v1/connections/:connection_id/revoke', async (c) => {
    return c.json(
      ok(
        await revoke_connection_as_user(c.get('db'), {
          workspace_id: c.get('workspace_id'),
          connection_id: c.req.param('connection_id'),
          acting_user_id: c.get('user_id'),
          actor_id: c.get('user_id'),
        }),
      ),
    );
  })
  .post(
    '/v1/connections/:connection_id/reconnect',
    validate_json(reconnect_connection_schema),
    async (c) => {
      const body = c.req.valid('json');
      refuse_redirect_uri_outside_allowed_origins(body.redirect_uri);
      const reconnected = await reconnect_connection_for_user(c.get('db'), {
        workspace_id: c.get('workspace_id'),
        connection_id: c.req.param('connection_id'),
        acting_user_id: c.get('user_id'),
        actor_id: c.get('user_id'),
        ...body,
      });
      if ('tools_read_again' in reconnected) return c.json(ok(reconnected));
      const { connection, provider_key } = reconnected;
      const pending_setup = await get_pending_provider_connection_setup(c.get('db'), {
        workspace_id: c.get('workspace_id'),
        connection_id: connection.connection_id,
        provider_key,
      });
      return c.json(
        ok({
          connection,
          ...public_connection_setup_start({
            connection: { connection_id: connection.connection_id },
            setup: pending_setup.setup_state,
          }),
        }),
      );
    },
  )
  .patch('/v1/connections/:connection_id', validate_json(patch_connection_schema), async (c) => {
    const body = c.req.valid('json');
    return c.json(
      ok(
        await patch_connection_as_user(c.get('db'), {
          workspace_id: c.get('workspace_id'),
          connection_id: c.req.param('connection_id'),
          acting_user_id: c.get('user_id'),
          actor_id: c.get('user_id'),
          ...body,
        }),
      ),
    );
  })
  .post(
    '/v1/connections/:connection_id/access/members',
    validate_json(add_access_member_schema),
    async (c) => {
      const body = c.req.valid('json');
      return c.json(
        ok(
          await add_connection_access_member(c.get('db'), {
            workspace_id: c.get('workspace_id'),
            connection_id: c.req.param('connection_id'),
            member: {
              user_id: body.user_id,
              ...(body.can_delete === undefined ? {} : { can_delete: body.can_delete }),
              ...(body.can_edit_tools === undefined ? {} : { can_edit_tools: body.can_edit_tools }),
            },
            acting_user_id: c.get('user_id'),
            actor_id: c.get('user_id'),
          }),
        ),
      );
    },
  )
  .delete('/v1/connections/:connection_id/access/members/:user_id', async (c) => {
    return c.json(
      ok(
        await remove_connection_access_member(c.get('db'), {
          workspace_id: c.get('workspace_id'),
          connection_id: c.req.param('connection_id'),
          member_user_id: c.req.param('user_id'),
          acting_user_id: c.get('user_id'),
          actor_id: c.get('user_id'),
        }),
      ),
    );
  });

function refuse_redirect_uri_outside_allowed_origins(redirect_uri: string | undefined) {
  if (!redirect_uri) return;

  const origin = read_redirect_uri_origin(redirect_uri);
  if (!origin || !allowed_return_origins().has(origin)) {
    throw new ValidationError('redirect_uri must be on an allowed origin', { origin });
  }
}

function read_redirect_uri_origin(redirect_uri: string) {
  return URL.parse(redirect_uri)?.origin ?? null;
}

async function complete_oauth_callback(c: Context<ApiEnv>) {
  const state_token = c.req.query('state');
  if (!state_token) {
    throw new NotFoundError('Connection');
  }

  const setup = await get_pending_oauth_connection_setup(c.get('db'), {
    state_token,
  });
  const error = c.req.query('error');
  if (error) {
    return record_failed_oauth_callback(c, setup, state_token, {
      error_message: c.req.query('error_description') ?? error,
    });
  }

  const code = c.req.query('code');
  if (!code) {
    throw new NotFoundError('Connection');
  }

  let token_response: Awaited<ReturnType<typeof exchange_oauth_code_for_tokens>>;
  try {
    token_response = await exchange_oauth_code_for_tokens({
      setup_state: setup.setup_state,
      code,
      credentials: setup.credentials,
    });
  } catch (exchange_error) {
    return record_failed_oauth_callback(c, setup, state_token, {
      error_message: format_error_message(exchange_error),
    });
  }

  const external_account_id = find_external_account_id(token_response);
  if (external_account_id) {
    const claim = await claim_external_account_for_connection(c.get('db'), {
      provider_key: setup.provider_key,
      provider_config_key: setup.provider_config_key,
      external_account_id,
      claiming_workspace_id: setup.workspace_id,
      claiming_connection_id: setup.connection_id,
      actor_id: setup.actor_id,
      probe_incumbent_liveness: probe_slack_connection_liveness,
    });
    if (claim.outcome === 'conflict') {
      return reject_claimed_account(c, setup, state_token);
    }
  }

  let connection: Awaited<ReturnType<typeof finalize_oauth_connection_with_resume>>;
  try {
    connection = await finalize_oauth_connection_with_resume(c.get('db'), {
      workspace_id: setup.workspace_id,
      state_token,
      status: 'success',
      token_response,
      actor_id: setup.actor_id,
      setup_state: setup.setup_state,
    });
  } catch (error) {
    if (!is_exclusive_account_conflict(error)) throw error;
    return reject_claimed_account(c, setup, state_token);
  }
  const default_channel = await upsert_default_slack_channel_for_connection(c.get('db'), {
    connection,
    actor_id: setup.actor_id,
  });
  const scout_trigger = await create_workspace_scout_trigger(c.get('db'), {
    workspace_id: setup.workspace_id,
    actor_id: setup.actor_id,
  });

  const body = {
    connection,
    ...(default_channel ? { default_channel } : {}),
    ...(scout_trigger ? { scout_trigger } : {}),
  };
  return oauth_callback_response(c, setup.setup_state, {
    connection_id: connection.connection_id,
    fallback_body: body,
  });
}

async function record_failed_oauth_callback(
  c: Context<ApiEnv>,
  setup: Awaited<ReturnType<typeof get_pending_oauth_connection_setup>>,
  state_token: string,
  input: { error_message: string },
) {
  const connection = await finalize_oauth_connection_with_resume(c.get('db'), {
    workspace_id: setup.workspace_id,
    state_token,
    status: 'error',
    error_message: input.error_message,
    actor_id: setup.actor_id,
    setup_state: setup.setup_state,
  });
  return oauth_callback_response(c, setup.setup_state, {
    connection_id: connection.connection_id,
    error_message: input.error_message,
    fallback_body: connection,
  });
}

const claimed_account_conflict_message =
  'This Slack workspace is already connected to another Alfera workspace. Ask its admin to ' +
  'disconnect it there first, or remove the Alfera app from Slack, then try again.';

async function reject_claimed_account(
  c: Context<ApiEnv>,
  setup: Awaited<ReturnType<typeof get_pending_oauth_connection_setup>>,
  state_token: string,
) {
  const connection = await finalize_oauth_connection(c.get('db'), {
    workspace_id: setup.workspace_id,
    state_token,
    status: 'error',
    error_message: claimed_account_conflict_message,
    actor_id: setup.actor_id,
  });
  return oauth_callback_response(c, setup.setup_state, {
    connection_id: connection.connection_id,
    error_message: claimed_account_conflict_message,
    fallback_body: connection,
  });
}

function is_exclusive_account_conflict(error: unknown): boolean {
  return is_unique_violation_of(error, 'idx_connections_exclusive_account_active');
}

function oauth_callback_response(
  c: Context<ApiEnv>,
  setup_state: ConnectionSetupStateData,
  input: {
    connection_id: string;
    error_message?: string | undefined;
    fallback_body: unknown;
  },
) {
  const return_uri = safe_oauth_return_uri(setup_state);
  if (!return_uri) return c.json(ok(input.fallback_body));

  return_uri.searchParams.set('connection_id', input.connection_id);
  if (input.error_message) return_uri.searchParams.set('error_description', input.error_message);

  return c.redirect(return_uri.toString(), 302);
}

function safe_oauth_return_uri(setup_state: ConnectionSetupStateData) {
  const return_uri = connection_setup_redirect_uri(setup_state);
  if (!return_uri) return null;

  const url = URL.parse(return_uri);
  return url && allowed_return_origins().has(url.origin) ? url : null;
}

async function finalize_completed_provider_connection(
  db: Database,
  input: {
    workspace_id: string;
    connection_id: string;
    provider_key: string;
    actor_id: string;
    setup_state: ConnectionSetupStateData;
    completion: ProviderConnectionCompletion;
  },
) {
  if (input.completion.status === 'pending') {
    throw new AppError('provider_connection_not_ready', input.completion.message, 409);
  }

  const connection = await finalize_provider_connection_with_resume(db, {
    workspace_id: input.workspace_id,
    connection_id: input.connection_id,
    provider_key: input.provider_key,
    actor_id: input.actor_id,
    setup_state: input.setup_state,
    ...input.completion,
  });
  await start_listen_ears_for_connection(db, {
    workspace_id: input.workspace_id,
    connection_id: input.connection_id,
    actor_id: input.actor_id,
  });
  return connection;
}

function public_connection_setup_start(result: {
  connection: { connection_id: string };
  setup: ConnectionSetupStateData;
}) {
  return {
    setup: redact_connection_setup_state(result.setup),
    start_url: build_connection_start_url({
      connection_id: result.connection.connection_id,
      setup_token: result.setup.setup_token,
    }),
  };
}

function connection_setup_redirect_uri(setup_state: ConnectionSetupStateData) {
  return setup_state.redirect_uri ?? undefined;
}

function connection_setup_url(setup: PublicConnectionSetup) {
  return setup.hosted_connect_link ?? setup.authorization_url;
}

function connection_setup_error(setup: PublicConnectionSetup) {
  return setup.setup_error;
}

function public_connection_setup_app(app: {
  app_id: string;
  app_name: string;
  app_display_name: string;
  display_config: AppDisplayConfigData;
  metadata: AppMetadataData;
}) {
  return {
    app_id: app.app_id,
    app_name: app.app_name,
    app_display_name: app.app_display_name,
    display_config: public_app_display_fields(app.display_config),
    metadata: public_app_display_fields(app.metadata),
  };
}

function public_app_display_fields(fields: PublicAppFields) {
  return Object.fromEntries(
    ['description', 'icon_url']
      .map((key) => [key, fields[key as keyof PublicAppFields]] as const)
      .filter((entry): entry is readonly [string, string] => Boolean(entry[1])),
  );
}

function require_connection_provider_adapter(provider_key: string | null | undefined) {
  const adapter = find_connection_provider_adapter(provider_key);
  if (!adapter) {
    throw new ValidationError('Provider setup completion is not supported for this provider');
  }
  return adapter;
}

function verify_provider_webhook_token(
  adapter: HostedConnectionProviderAdapter,
  token: string,
  setup_state: ConnectionSetupStateData,
) {
  const expected_token = adapter.read_webhook_token?.(setup_state) ?? null;
  if (!expected_token || !secure_strings_equal(token, expected_token)) {
    throw new AppError('invalid_provider_webhook_token', 'Invalid provider webhook token', 401);
  }
}
