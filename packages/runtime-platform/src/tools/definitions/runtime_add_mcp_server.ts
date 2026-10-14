import { public_env } from '@coworker/config/public_env';
import { resolve_user_id_for_source_actor } from '@coworker/core/db/queries/source_actors';
import { find_active_workspace_member_role } from '@coworker/core/db/queries/workspace_membership';
import { is_workspace_administrator_role } from '@coworker/shared';
import { build_connection_resume_intent } from '@runtime-platform/connections/connection_resume_intent';
import { define_mcp_client_connection } from '@runtime-platform/connections/mcp_client_connection';
import type {
  RuntimeToolDefinition,
  RuntimeToolExecutionContext,
} from '@runtime-platform/tools/types';
import { z } from 'zod';

const input_schema = z.object({
  server_url: z.string().trim().min(1).max(2048),
  display_name: z.string().trim().min(1).max(160).optional(),
});

export const runtime_add_mcp_server_tool: RuntimeToolDefinition<typeof input_schema> = {
  node_key: 'runtime-add_mcp_server-1',
  node_name: 'add_mcp_server',
  display_name: 'Add MCP server',
  description:
    'Adds an MCP server to the workspace from ITS ADDRESS. Use this only after runtime-create_connection-1 has answered app_not_found for the product, because a catalog integration is the better connection whenever one exists and this tool cannot tell that a product has one. A server needing no credential is usable immediately and reports how many tools it added. A server that wants a sign-in returns a start_url; the chat shows it as a card the person clicks, so say that you have asked them to sign in and DO NOT paste the URL into your message. A server that authenticates with a token the person holds cannot be added here — send them to Integrations, Add MCP server, where the token is typed into a password field instead of a chat message.',
  category: 'actions',
  input_schema: {
    type: 'object',
    properties: {
      server_url: {
        type: 'string',
        description:
          'Address of the MCP server, usually ending in /mcp, for example https://mcp.linear.app/mcp.',
      },
      display_name: {
        type: 'string',
        description:
          'Optional name to show. Leave it out and the server is asked what it calls itself.',
      },
    },
    required: ['server_url'],
    additionalProperties: false,
  },
  output_schema: {
    type: 'object',
    properties: {
      type: { type: 'string' },
      kind: { type: 'string' },
      app_name: { type: 'string' },
      app: {
        type: 'object',
        properties: {
          app_id: { type: 'string' },
          app_name: { type: 'string' },
          app_display_name: { type: 'string' },
          icon_url: { type: 'string' },
        },
        required: ['app_id', 'app_name', 'app_display_name'],
      },
      tool_count: { type: 'number' },
      start_url: { type: 'string' },
      message_for_user: { type: 'string' },
    },
    required: ['kind', 'message_for_user'],
  },
  app_name: 'runtime',
  required_connection: false,
  runtime_handler: 'runtime.add_mcp_server',
  approval_policy: { mode: 'none' },
  source_context_policy: { mode: 'current_turn' },
  metadata: { safe_for_first_milestone: false },
  validate_input: input_schema,
  async execute(input, context) {
    if (!context) {
      return {
        success: false,
        error: {
          code: 'runtime_context_unavailable',
          message: 'runtime-add_mcp_server-1 requires a runtime execution context.',
        },
      };
    }

    const denial = await refuse_non_admin(context);
    if (denial) return denial;

    const resume = await build_connection_resume_intent({ context });

    const outcome = await define_mcp_client_connection({
      db: context.db,
      workspace_id: context.workspace_id,
      actor_id: context.actor_id,
      server_url: input.server_url,
      ...(input.display_name ? { display_name: input.display_name } : {}),
      redirect_uri: new URL('/connect/callback', public_env.NEXT_PUBLIC_APP_URL).toString(),
      setup_session_id: context.session_id,
      ...(resume ? { resume } : {}),
    });

    if (outcome.kind === 'refused') {
      return { success: false, error: { code: 'mcp_server_refused', message: outcome.because } };
    }

    if (outcome.kind === 'connected') {
      return {
        success: true,
        data: {
          kind: 'connected',
          app_name: outcome.app_name,
          tool_count: outcome.tool_count,
          message_for_user: `${outcome.app_name} is connected with ${outcome.tool_count} tools. Search your tools to use them.`,
        },
      };
    }

    return {
      success: true,
      data: {
        type: 'connection_setup',
        kind: 'needs_authorization',
        app: {
          app_id: outcome.app_id,
          app_name: outcome.app_key,
          app_display_name: outcome.app_name,
          ...(outcome.icon_url ? { icon_url: outcome.icon_url } : {}),
        },
        start_url: outcome.start_url,
        message_for_user: `${outcome.app_name} needs you to sign in. I have put a Connect button in the chat.`,
      },
    };
  },
};

async function refuse_non_admin(context: RuntimeToolExecutionContext) {
  const user_id = await speaking_user_id(context);
  const role = user_id
    ? await find_active_workspace_member_role(context.db, {
        workspace_id: context.workspace_id,
        user_id,
      })
    : undefined;
  if (is_workspace_administrator_role(role)) return null;

  return {
    success: false as const,
    error: {
      code: 'mcp_server_access_denied',
      message: 'Adding an MCP server requires workspace admin access.',
    },
  };
}

async function speaking_user_id(context: RuntimeToolExecutionContext) {
  const source_actor_id = context.speaker?.source_actor_id;
  if (!source_actor_id) return context.actor_id;
  return resolve_user_id_for_source_actor(context.db, {
    workspace_id: context.workspace_id,
    source_actor_id,
  });
}
