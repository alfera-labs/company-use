import { public_env } from '@coworker/config/public_env';
import {
  build_connection_resume_intent,
  max_resume_instruction_length,
} from '@runtime-platform/connections/connection_resume_intent';
import { create_connection_setup_for_a_person } from '@runtime-platform/connections/connection_setup_for_a_person';
import { build_connection_start_url } from '@runtime-platform/connections/connection_start_link';
import { find_connectable_app } from '@runtime-platform/connections/find_connectable_app';
import type { RuntimeToolDefinition } from '@runtime-platform/tools/types';
import { z } from 'zod';

const input_schema = z.object({
  app_name: z.string().min(1),
  provider_key: z.string().min(1).optional(),
  provider_config_key: z.string().min(1).optional(),
  connection_profile_key: z.string().min(1).optional(),
  connection_name: z.string().min(1).max(160).optional(),
  resume_instruction: z.string().trim().min(1).max(max_resume_instruction_length).optional(),
});

export const runtime_create_connection_tool: RuntimeToolDefinition<typeof input_schema> = {
  node_key: 'runtime-create_connection-1',
  node_name: 'create_connection',
  display_name: 'Create connection',
  description:
    'Returns a user-clickable setup link for connecting an app to the workspace. The user starts the credential flow by opening the returned start_url. Put it in your next message as a Markdown link whose text is the app name, e.g. [Connect Attio](start_url); never paste the bare URL, and never shorten or retype it.',
  category: 'actions',
  input_schema: {
    type: 'object',
    properties: {
      app_name: {
        type: 'string',
        description: 'App name to connect, for example gmail, slack, google_sheets, or hubspot.',
      },
      provider_key: {
        type: 'string',
        description: 'Optional provider key when the app has multiple provider configs.',
      },
      provider_config_key: {
        type: 'string',
        description: 'Optional provider config key when a specific provider config is needed.',
      },
      connection_profile_key: {
        type: 'string',
        description: 'Optional connection profile key when a specific profile is needed.',
      },
      connection_name: {
        type: 'string',
        description: 'Optional user-facing name for the new connection.',
      },
      resume_instruction: {
        type: 'string',
        minLength: 1,
        maxLength: 500,
        description:
          'Restate the exact task to continue once the connection activates. Leave it out and the last thing the person asked for is used.',
      },
    },
    required: ['app_name'],
    additionalProperties: false,
  },
  output_schema: {
    type: 'object',
    properties: {
      type: { type: 'string' },
      app: {
        type: 'object',
        properties: {
          app_id: { type: 'string' },
          app_name: { type: 'string' },
          app_display_name: { type: 'string' },
          description: { type: 'string' },
          icon_url: { type: 'string' },
        },
        required: ['app_id', 'app_name', 'app_display_name'],
      },
      start_url: { type: 'string' },
      message_for_user: { type: 'string' },
    },
    required: ['type', 'app', 'start_url', 'message_for_user'],
  },
  app_name: 'runtime',
  required_connection: false,
  runtime_handler: 'runtime.create_connection',
  approval_policy: { mode: 'none' },
  source_context_policy: { mode: 'current_turn' },
  metadata: { safe_for_first_milestone: true, approval_display_fields: ['app_name'] },
  validate_input: input_schema,
  async execute(input, context) {
    if (!context) {
      return {
        success: false,
        error: {
          code: 'runtime_context_unavailable',
          message: 'runtime-create_connection-1 requires a runtime execution context.',
        },
      };
    }

    const app = await find_connectable_app(context.db, context.workspace_id, input.app_name);
    if (!app) {
      return {
        success: false,
        error: {
          code: 'app_not_found',
          message: `${input.app_name} is not in the catalog, but it can still be connected. Load the managing-connections skill — the catalog is the first of three routes, and it explains the other two: an MCP server if the product ships one, or working out how the website signs people in.`,
        },
      };
    }

    if ('hold' in app) {
      return {
        success: false,
        error: {
          code: 'app_on_hold',
          message: `${app.app_display_name} cannot be connected yet: ${app.hold.reason}`,
        },
      };
    }

    if (!has_connection_profile(app.metadata)) {
      return {
        success: false,
        error: {
          code: 'connection_profile_missing',
          message: `${app.app_display_name} does not have an active connection setup profile.`,
        },
      };
    }

    const resume = await build_connection_resume_intent({
      context,
      ...(input.resume_instruction ? { instruction: input.resume_instruction } : {}),
    });

    const pending_connection = await create_connection_setup_for_a_person(context.db, {
      workspace_id: context.workspace_id,
      actor_id: context.actor_id,
      app_id: app.app_id,
      ...(input.provider_key ? { provider_key: input.provider_key } : {}),
      ...(input.provider_config_key ? { provider_config_key: input.provider_config_key } : {}),
      ...(input.connection_profile_key
        ? { connection_profile_key: input.connection_profile_key }
        : {}),
      ...(input.connection_name ? { connection_name: input.connection_name } : {}),
      redirect_uri: build_connection_return_url(),
      setup_session_id: context.session_id,
      ...(resume ? { resume } : {}),
    });
    const start_url = build_connection_start_url({
      connection_id: pending_connection.connection.connection_id,
      setup_token: pending_connection.setup.setup_token,
    });
    if (!start_url) {
      return {
        success: false,
        error: {
          code: 'connection_setup_token_missing',
          message: 'Connection setup could not create a branded start URL.',
        },
      };
    }

    const description = app.metadata.description ?? app.display_config.description;
    const icon_url = app.metadata.icon_url ?? app.display_config.icon_url;
    return {
      success: true,
      data: {
        type: 'connection_setup',
        app: {
          app_id: app.app_id,
          app_name: app.app_name,
          app_display_name: app.app_display_name,
          ...(description ? { description } : {}),
          ...(icon_url ? { icon_url } : {}),
        },
        start_url,
        message_for_user: `[Connect ${app.app_display_name}](${start_url})`,
      },
      metadata: {
        ui_kind: 'connection_setup',
        connection_start_url: start_url,
        connection_id: pending_connection.connection.connection_id,
        app_name: app.app_name,
      },
    };
  },
};

function build_connection_return_url() {
  const url = new URL('/connect/callback', public_env.NEXT_PUBLIC_APP_URL);
  return url.toString();
}

function has_connection_profile(metadata: {
  provider_configs?: Array<{
    status: string;
    connection_profiles: Array<{ status: string }>;
  }>;
}) {
  return (
    metadata.provider_configs?.some(
      (config) =>
        config.status === 'active' &&
        config.connection_profiles.some((profile) => profile.status === 'active'),
    ) ?? false
  );
}
