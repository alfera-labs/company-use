import type { ApiEnv } from '@api/lib/context';
import { allowed_cors_origins } from '@api/lib/cors_origins';
import { answer_request_error } from '@api/lib/request_error_answer';
import { request_logger } from '@api/lib/request_logger';
import { error_body } from '@api/lib/response';
import { attach_workspace } from '@api/middleware';
import { access_routes } from '@api/routes/access';
import { admin_billing_routes } from '@api/routes/admin_billing';
import { agent_routes } from '@api/routes/agents';
import { ai_account_routes } from '@api/routes/ai_account_routes';
import { api_access_request_routes } from '@api/routes/api_access_requests';
import { api_key_routes } from '@api/routes/api_keys';
import { approval_routes } from '@api/routes/approvals';
import { automation_route_group } from '@api/routes/automation_route_group';
import { billing_routes } from '@api/routes/billing';
import { billing_webhook_routes } from '@api/routes/billing_webhook';
import { brain_answer_routes } from '@api/routes/brain/answers';
import { brain_library_routes } from '@api/routes/brain/library';
import { brain_mcp_routes } from '@api/routes/brain/mcp';
import { member_link_routes } from '@api/routes/brain/member_links';
import { brain_memory_routes } from '@api/routes/brain/memory';
import { memory_dashboard_history_routes } from '@api/routes/brain/memory_dashboard_history';
import { memory_dashboard_proposal_routes } from '@api/routes/brain/memory_dashboard_proposals';
import { brain_source_routes } from '@api/routes/brain_sources';
import { brain_webhook_routes } from '@api/routes/brain_webhooks';
import { catalog_routes, public_catalog_routes } from '@api/routes/catalog';
import { channel_config_routes, channel_event_routes } from '@api/routes/channels';
import { choices_routes } from '@api/routes/choices';
import { company_use_deploy_routes } from '@api/routes/company_use_deploy';
import { compat_routes } from '@api/routes/compat';
import { connection_credential_routes } from '@api/routes/connection_credentials';
import { connection_routes, public_connection_routes } from '@api/routes/connections';
import { public_conversion_routes } from '@api/routes/conversions';
import { public_demo_request_routes } from '@api/routes/demo_requests';
import { dev_settings_routes } from '@api/routes/dev_settings';
import { event_routes } from '@api/routes/events';
import { create_file_upload_routes } from '@api/routes/file_uploads';
import { health_routes } from '@api/routes/health';
import { mcp_server_routes } from '@api/routes/mcp_servers';
import { model_routes } from '@api/routes/models';
import { my_timezone_routes } from '@api/routes/my_timezone';
import { notification_rules_routes } from '@api/routes/notification_rules';
import { notification_routes } from '@api/routes/notifications';
import { onboarding_routes } from '@api/routes/onboarding';
import { policy_routes } from '@api/routes/policies';
import { project_routes } from '@api/routes/projects';
import { public_agent_routes } from '@api/routes/public_agents';
import { public_automation_routes } from '@api/routes/public_automations';
import { public_integration_routes } from '@api/routes/public_integrations';
import { public_me_routes } from '@api/routes/public_me';
import { public_openapi_routes } from '@api/routes/public_openapi';
import { public_project_routes } from '@api/routes/public_projects';
import { public_session_event_routes } from '@api/routes/public_session_events';
import { public_session_file_routes } from '@api/routes/public_session_files';
import { public_session_routes } from '@api/routes/public_sessions';
import { public_skill_routes } from '@api/routes/public_skills';
import { public_usage_routes } from '@api/routes/public_usage';
import { public_workspace_routes } from '@api/routes/public_workspace';
import { rewards_routes } from '@api/routes/rewards';
import { live_run_event_routes } from '@api/routes/run_events_live_stream';
import { run_queued_jobs_routes } from '@api/routes/run_queued_jobs';
import { session_queued_message_routes } from '@api/routes/session_queued_messages';
import { session_search_routes } from '@api/routes/session_search';
import { session_stream_ticket_routes } from '@api/routes/session_stream_ticket';
import { session_routes } from '@api/routes/sessions';
import { sign_in_routes } from '@api/routes/sign_in_routes';
import { slack_routes } from '@api/routes/slack/routes';
import { stub_routes } from '@api/routes/stubs';
import { public_templates_routes, templates_routes } from '@api/routes/templates_catalog';
import { trigger_delivery_routes } from '@api/routes/trigger_deliveries';
import { workos_webhook_routes } from '@api/routes/workos_webhook';
import { workspace_routes } from '@api/routes/workspace';
import { workspace_email_address_routes } from '@api/routes/workspace_email_address';
import { workspace_files_routes } from '@api/routes/workspace_files';
import '@api/services/ad_conversions/register_scout_observer';
import '@api/services/notifications/register_scout_observer';
import { env } from '@coworker/config';
import type { Database } from '@coworker/core';
import { Hono, type MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import { requestId } from 'hono/request-id';

function attach_database(db: Database): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    c.set('db', db);
    await next();
  };
}

function allow_browser_origins() {
  return cors({
    origin: allowed_cors_origins(),
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
    allowHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning'],
    credentials: true,
  });
}

export function create_app(db: Database) {
  const app = new Hono<ApiEnv>();

  app.use('*', requestId());

  if (env.NODE_ENV !== 'test') {
    app.use('*', request_logger());
  }

  app.use('*', attach_database(db));

  app.route('/', run_queued_jobs_routes).route('/', company_use_deploy_routes);

  app.use('*', allow_browser_origins());

  const api_routes = app
    .route('/', health_routes)
    .route('/', channel_event_routes)
    .route('/', trigger_delivery_routes)
    .route('/', sign_in_routes)
    .route('/', public_connection_routes)
    .route('/', public_catalog_routes)
    .route('/', public_templates_routes)
    .route('/', public_demo_request_routes)
    .route('/', public_conversion_routes)
    .route('/', billing_webhook_routes)
    .route('/', workos_webhook_routes)
    .route('/', event_routes)
    .route('/', brain_memory_routes)
    .route('/', brain_answer_routes)
    .route('/', brain_mcp_routes)
    .route('/', public_openapi_routes)
    .route('/', public_me_routes)
    .route('/', public_agent_routes)
    .route('/', public_session_routes)
    .route('/', public_session_event_routes)
    .route('/', public_session_file_routes)
    .route('/', public_project_routes)
    .route('/', public_automation_routes)
    .route('/', public_usage_routes)
    .route('/', public_integration_routes)
    .route('/', public_skill_routes)
    .route('/', public_workspace_routes)
    .route('/', compat_routes)
    .route('/', brain_webhook_routes)
    .use('/v1/*', attach_workspace())
    .route('/', api_key_routes)
    .route('/', brain_source_routes)
    .route('/', brain_library_routes)
    .route('/', memory_dashboard_history_routes)
    .route('/', memory_dashboard_proposal_routes)
    .route('/', member_link_routes)
    .route('/', api_access_request_routes)
    .route('/', create_file_upload_routes())
    .route('/', workspace_routes)
    .route('/', workspace_email_address_routes)
    .route('/', workspace_files_routes)
    .route('/', dev_settings_routes)
    .route('/', admin_billing_routes)
    .route('/', billing_routes)
    .route('/', channel_config_routes)
    .route('/', agent_routes)
    .route('/', catalog_routes)
    .route('/', connection_routes)
    .route('/', connection_credential_routes)
    .route('/', mcp_server_routes)
    .route('/', templates_routes)
    .route('/', live_run_event_routes)
    .route('/', model_routes)
    .route('/', ai_account_routes)
    // Ahead of session_routes on purpose: `/v1/sessions/search` collides with
    // `/v1/sessions/:session_id`, and the first match wins.
    .route('/', session_search_routes)
    .route('/', session_routes)
    .route('/', session_queued_message_routes)
    .route('/', session_stream_ticket_routes)
    .route('/', onboarding_routes)
    .route('/', my_timezone_routes)
    .route('/', rewards_routes)
    .route('/', slack_routes)
    .route('/', automation_route_group)
    .route('/', notification_routes)
    .route('/', notification_rules_routes)
    .route('/', project_routes)
    .route('/', access_routes)
    .route('/', policy_routes)
    .route('/', approval_routes)
    .route('/', choices_routes)
    .route('/', stub_routes);

  api_routes.notFound((c) => c.json(error_body('not_found', 'Route not found'), 404));

  api_routes.onError(answer_request_error);

  return api_routes;
}

export type ApiApp = ReturnType<typeof create_app>;
