import type { ApiEnv } from '@api/lib/context';
import { type McpOauthSettings, read_mcp_oauth_settings } from '@api/lib/mcp_oauth';
import { error_body } from '@api/lib/response';
import { openai_apps_challenge_routes } from '@api/routes/brain/openai_apps_challenge';
import { env } from '@coworker/config';
import { Hono } from 'hono';

const mcp_path = '/v1/mcp';
const resource_metadata_path = '/.well-known/oauth-protected-resource';

export const mcp_oauth_routes = new Hono<ApiEnv>()
  .get(resource_metadata_path, () => answer_resource_metadata(read_mcp_oauth_settings()))
  .get(`${resource_metadata_path}${mcp_path}`, () =>
    answer_resource_metadata(read_mcp_oauth_settings()),
  )
  .route('/', openai_apps_challenge_routes);

export function answer_resource_metadata(settings: McpOauthSettings | null): Response {
  if (!settings) {
    return Response.json(error_body('not_found', 'This MCP endpoint takes API keys only'), {
      status: 404,
    });
  }
  return Response.json({
    resource: settings.resource,
    authorization_servers: [settings.issuer],
    bearer_methods_supported: ['header'],
    scopes_supported: [],
  });
}

export function sign_in_challenge_header(): string {
  const metadata_url = new URL(resource_metadata_path, mcp_resource_url()).href;
  return (
    `Bearer error="unauthorized", error_description="Sign in to Alfera to use this MCP server", ` +
    `resource_metadata="${metadata_url}"`
  );
}

export function mcp_resource_url(): string {
  return new URL(mcp_path, env.API_PUBLIC_URL ?? env.API_URL).href;
}
