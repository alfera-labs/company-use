import type { ApiEnv } from '@api/lib/context';
import { ok } from '@api/lib/response';
import { validate_json, validate_query } from '@api/lib/validate';
import { assert_may_set_channel_project } from '@api/routes/slack/channel_project_access';
import { apply_slack_channel_access } from '@api/routes/slack/slack_channel_access_view';
import { find_slack_app_this_install_can_connect } from '@api/services/connections/app_this_install_can_connect';
import { create_pending_connection_setup } from '@coworker/core/db/queries/connection_management';
import { record_onboarding_channels_joined } from '@coworker/core/db/queries/onboarding';
import { AppError, format_error_message } from '@coworker/shared';
import {
  list_slack_channel_access_rows,
  set_slack_channel_access,
} from '@runtime-platform/channels/slack/channel_setup';
import { find_active_slack_connection_for_workspace } from '@runtime-platform/channels/slack/workspace_connection';
import { build_connection_start_url } from '@runtime-platform/connections/connection_start_link';
import {
  build_public_connection_setup,
  redact_connection_setup_state,
} from '@runtime-platform/connections/oauth_connection_setup';
import {
  native_slack_connection_profile_key,
  native_slack_provider_config_key,
  native_slack_provider_key,
} from '@runtime-platform/tools/slack/app_profile';
import {
  fetch_public_slack_channels,
  fetch_slack_channel_is_private,
  fetch_slack_channels,
  join_slack_channel,
  read_slack_bot_token,
} from '@runtime-platform/tools/slack/channels_api';
import { type Context, Hono } from 'hono';
import { z } from 'zod';

const slack_connect_schema = z.object({
  redirect_uri: z.string().url().optional(),
});

const join_channels_schema = z
  .object({
    all_public: z.boolean().optional(),
    channel_ids: z.array(z.string().min(1)).max(1000).optional(),
  })
  .refine((value) => value.all_public === true || (value.channel_ids?.length ?? 0) > 0, {
    message: 'Provide channel_ids or set all_public',
  });

const channel_settings_query_schema = z.object({
  cursor: z.string().min(1).optional(),
  visibility: z.enum(['public', 'private']).default('public'),
});

const channel_access_schema = z.object({
  enabled: z.boolean(),
  // The project conversations in this channel start in. Absent keeps the current one; null takes
  // the channel out of any project.
  project_id: z.string().min(1).nullable().optional(),
  // Display only, so the project page can name the channel without asking Slack.
  channel_name: z.string().min(1).max(200).optional(),
});

type PublicConnectionSetup = { authorization_url?: string; setup_error?: string };

const max_public_channels_to_join = 500;
const max_channel_pages_to_scan = 25;
const join_concurrency = 5;

export const slack_routes = new Hono<ApiEnv>()
  .post('/v1/slack/connect', validate_json(slack_connect_schema), async (c) => {
    const body = c.req.valid('json');
    const app = await find_slack_app_this_install_can_connect(c.get('db'));
    const result = await create_pending_connection_setup(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      actor_id: c.get('user_id'),
      app_id: app.app_id,
      provider_key: native_slack_provider_key,
      provider_config_key: native_slack_provider_config_key,
      connection_profile_key: native_slack_connection_profile_key,
      ...(body.redirect_uri ? { redirect_uri: body.redirect_uri } : {}),
    });
    const setup = await build_public_connection_setup({
      provider_key: result.connection.provider_key,
      setup_state: result.setup,
      db: c.get('db'),
      ...(body.redirect_uri ? { redirect_uri: body.redirect_uri } : {}),
      request_origin: c.req.header('origin'),
    });
    const public_setup = setup as PublicConnectionSetup;

    if (!public_setup.authorization_url?.trim()) {
      throw new AppError(
        'slack_connect_unavailable',
        public_setup.setup_error ??
          'Slack OAuth could not be started. Set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET on the API and try again.',
        500,
      );
    }

    const start_url = build_connection_start_url({
      connection_id: result.connection.connection_id,
      setup_token: result.setup.setup_token,
    });
    if (!start_url) {
      throw new AppError(
        'slack_connect_unavailable',
        'Slack connection setup produced no start link.',
        500,
      );
    }

    return c.json(
      ok({
        connection: result.connection,
        setup: redact_connection_setup_state(result.setup),
        start_url,
      }),
      201,
    );
  })
  .get('/v1/slack/channels', async (c) => {
    const slack_connection = await resolve_slack_connection(c);
    const cursor = c.req.query('cursor');
    const page = await fetch_public_slack_channels(slack_connection.token, {
      ...(cursor ? { cursor } : {}),
    });
    return c.json(ok(page));
  })
  .get('/v1/slack/channel-settings', validate_query(channel_settings_query_schema), async (c) => {
    const slack_connection = await resolve_slack_connection(c);
    const query = c.req.valid('query');
    const page = await fetch_slack_channels(slack_connection.token, {
      visibility: query.visibility,
      ...(query.cursor ? { cursor: query.cursor } : {}),
    });
    const access_rows = await list_slack_channel_access_rows(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      connection_id: slack_connection.connection.connection_id,
      external_account_id: slack_connection.connection.external_account_id,
      external_conversation_ids: page.channels.map((channel) => channel.id),
    });

    return c.json(
      ok({ ...page, channels: apply_slack_channel_access(page.channels, access_rows) }),
    );
  })
  .put(
    '/v1/slack/channel-settings/:channel_id',
    validate_json(channel_access_schema),
    async (c) => {
      const body = c.req.valid('json');
      const slack_connection = await resolve_slack_connection(c);
      const channel_id = c.req.param('channel_id');
      const is_private = await fetch_slack_channel_is_private(slack_connection.token, channel_id);
      if (body.project_id !== undefined) {
        await assert_may_set_channel_project(c, {
          connection_id: slack_connection.connection.connection_id,
          external_account_id: slack_connection.connection.external_account_id,
          external_conversation_id: channel_id,
          project_id: body.project_id,
        });
      }

      let already_in_channel = false;
      if (body.enabled && !is_private) {
        const result = await join_slack_channel(slack_connection.token, channel_id);
        already_in_channel = result.already_in_channel;
      }

      const channel = await set_slack_channel_access(c.get('db'), {
        connection: slack_connection.connection,
        external_conversation_id: channel_id,
        conversation_scope: is_private ? 'group' : 'channel',
        channel_status: body.enabled ? 'enabled' : 'disabled',
        ...(body.project_id === undefined ? {} : { project_id: body.project_id }),
        ...(body.channel_name ? { channel_name: body.channel_name } : {}),
        actor_id: c.get('user_id'),
      });

      return c.json(
        ok({
          channel_id,
          is_enabled: body.enabled,
          already_in_channel,
          channel_route_id: channel?.channel_id ?? null,
          project_id: channel?.project_id ?? null,
        }),
      );
    },
  )
  .post('/v1/slack/channels/join', validate_json(join_channels_schema), async (c) => {
    const body = c.req.valid('json');
    const slack_connection = await resolve_slack_connection(c);

    const channel_ids = body.all_public
      ? await collect_joinable_public_channel_ids(slack_connection.token)
      : (body.channel_ids ?? []);
    const results = await join_channels(slack_connection.token, channel_ids);
    const joined = results.filter((result) => result.joined);

    await record_onboarding_channels_joined(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      actor_id: c.get('user_id'),
      count: joined.length,
    });

    return c.json(ok({ requested: channel_ids.length, joined: joined.length, results }));
  });

async function resolve_slack_connection(c: Context<ApiEnv>) {
  const connection = await find_active_slack_connection_for_workspace(
    c.get('db'),
    c.get('workspace_id'),
  );
  if (!connection) {
    throw new AppError('slack_not_connected', 'Connect Slack before managing channels.', 409);
  }

  const token = read_slack_bot_token(connection);
  if (!token) {
    throw new AppError(
      'slack_connection_incomplete',
      'The Slack connection is missing a bot token. Reconnect Slack and try again.',
      409,
    );
  }

  if (!connection.external_account_id) {
    throw new AppError(
      'slack_connection_incomplete',
      'The Slack connection is missing a workspace id. Reconnect Slack and try again.',
      409,
    );
  }

  return {
    token,
    connection: { ...connection, external_account_id: connection.external_account_id },
  };
}

async function collect_joinable_public_channel_ids(token: string) {
  const ids: string[] = [];
  let cursor: string | undefined;
  let pages_scanned = 0;

  do {
    const page = await fetch_public_slack_channels(token, {
      limit: 200,
      ...(cursor ? { cursor } : {}),
    });
    for (const channel of page.channels) {
      if (!channel.is_member) ids.push(channel.id);
      if (ids.length >= max_public_channels_to_join) return ids;
    }
    pages_scanned += 1;
    cursor = page.next_cursor ?? undefined;
  } while (cursor && pages_scanned < max_channel_pages_to_scan);

  return ids;
}

type JoinChannelResult = {
  channel_id: string;
  joined: boolean;
  already_in_channel?: boolean;
  error?: string;
};

async function join_channels(token: string, channel_ids: string[]): Promise<JoinChannelResult[]> {
  return map_with_concurrency(channel_ids, join_concurrency, async (channel_id) => {
    try {
      const result = await join_slack_channel(token, channel_id);
      return { channel_id, joined: true, already_in_channel: result.already_in_channel };
    } catch (error) {
      return {
        channel_id,
        joined: false,
        error: format_error_message(error, 'Failed to join channel'),
      };
    }
  });
}

async function map_with_concurrency<TItem, TResult>(
  items: TItem[],
  limit: number,
  worker: (item: TItem) => Promise<TResult>,
): Promise<TResult[]> {
  const results: TResult[] = new Array(items.length);
  let next_index = 0;

  async function run_worker() {
    while (next_index < items.length) {
      const index = next_index++;
      const item = items[index];
      if (item === undefined) continue;
      results[index] = await worker(item);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run_worker));
  return results;
}
