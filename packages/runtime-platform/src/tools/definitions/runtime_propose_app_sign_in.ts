import { public_env } from '@coworker/config/public_env';
import { discovered_sign_in_schema } from '@coworker/core/credentials/discovered_sign_in';
import { build_connection_resume_intent } from '@runtime-platform/connections/connection_resume_intent';
import { create_app_awaiting_credentials } from '@runtime-platform/connections/discovered_app_service';
import type { RuntimeToolDefinition } from '@runtime-platform/tools/types';

const input_schema = discovered_sign_in_schema;

export const runtime_propose_app_sign_in_tool: RuntimeToolDefinition<typeof input_schema> = {
  node_key: 'runtime-propose_app_sign_in-1',
  node_name: 'propose_app_sign_in',
  display_name: 'Propose an app sign-in',
  description:
    'Hands over how a website signs people in, after you have worked it out by watching one throwaway login. Returns a link the person opens to type their own email and password. Load the connecting-a-new-app skill before using this — it explains how to find every field, and why you must never ask anyone for a password. You never supply the credential here.',
  category: 'actions',
  input_schema: {
    type: 'object',
    properties: {
      app_display_name: { type: 'string', description: 'What the site calls itself.' },
      website_host: {
        type: 'string',
        description: 'The site being connected, e.g. www.example.com. No scheme, no path.',
      },
      also_talks_to: {
        type: 'array',
        items: { type: 'string' },
        description: 'Any other hosts the app itself calls, e.g. an api. subdomain.',
      },
      logo_url: { type: 'string', description: 'og:image, apple-touch-icon, or favicon.' },
      recipe: {
        type: 'object',
        description:
          'The measured sign-in contract: visit_first, post_credentials_to, send_fields, always_send_headers, echo_cookie_into_header, rejected_when_any_field_present, read_wait_minutes_from_field, keep_cookies_named, and confirm_by_fetching (a page only a signed-in visitor can see). Put in always_send_headers only what the API itself requires — an Accept, a content type, a version header. They are sent on the sign-in requests, and recorded so a caller can send them on later API requests; they are never attached to every request to the host. List as few as the API actually needs: each one is repeated to whoever calls that API. NEVER put a password, API key, token, Authorization or Cookie there — credentials belong in send_fields and are handled outside the sandbox.',
      },
      sign_in_name_label: {
        type: 'string',
        description: 'What the site calls the first box, e.g. Email or Username.',
      },
      could_not_determine: {
        type: 'array',
        items: { type: 'string' },
        description: 'Anything you could not work out. Say so rather than guessing.',
      },
    },
    required: ['app_display_name', 'website_host', 'recipe'],
  },
  output_schema: {
    type: 'object',
    properties: {
      ready: { type: 'boolean' },
      connect_url: { type: 'string' },
      asks_for: { type: 'array', items: { type: 'string' } },
      message_for_user: { type: 'string' },
      because: { type: 'string' },
    },
    required: ['ready'],
  },
  app_name: 'runtime',
  required_connection: false,
  runtime_handler: 'runtime.propose_app_sign_in',
  approval_policy: { mode: 'none' },
  metadata: { safe_for_first_milestone: true },
  validate_input: input_schema,
  async execute(input, context) {
    if (!context) {
      return {
        success: false,
        error: {
          code: 'runtime_context_unavailable',
          message: 'runtime-propose_app_sign_in-1 requires a runtime execution context.',
        },
      };
    }

    const resume = await build_connection_resume_intent({ context });

    const outcome = await create_app_awaiting_credentials({
      db: context.db,
      workspace_id: context.workspace_id,
      actor_id: context.actor_id,
      discovered: input,
      ...(resume ? { resume } : {}),
    });

    if (!outcome.created) {
      return {
        success: true,
        data: {
          ready: false,
          because: outcome.because,
          message_for_user: `I could not set up ${input.app_display_name}: ${outcome.because}.`,
        },
      };
    }

    const connect_url = `${public_env.NEXT_PUBLIC_APP_URL}/integrations/connect/${outcome.connection_id}`;
    return {
      success: true,
      data: {
        ready: true,
        connect_url,
        asks_for: outcome.asks_for,
        message_for_user: `Open this to connect ${input.app_display_name}: ${connect_url} — it asks for your ${outcome.asks_for.join(' and ').toLowerCase()}. I will not see either.`,
      },
    };
  },
};
