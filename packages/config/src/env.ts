import {
  default_database_url,
  default_project_display_name,
  local_app_origin,
} from '@coworker/config/constants';
import { boolean_env_schema, port_schema } from '@coworker/config/env_value_schemas';
import { file_storage_env_schema } from '@coworker/config/file_storage_env';
import { founder_from_email, founder_reply_to_email } from '@coworker/config/founder_contact';
import * as hosted from '@coworker/config/hosted_defaults';
import { integration_env_schema } from '@coworker/config/integration_env';
import { model_provider_env_schema } from '@coworker/config/model_provider_env';
import { workspace_runtime_env_schema } from '@coworker/config/workspace_runtime_env';
import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

const json_record_env_schema = z.preprocess(
  (value) => {
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  },
  z.record(z.string(), z.string()),
);

const default_app_origin =
  process.env.NEXT_PUBLIC_APP_URL ||
  (process.env.NODE_ENV === 'production' ? hosted.production_app_origin : local_app_origin);
const default_app_usage_url = new URL('/usage', default_app_origin).toString();

export const env = createEnv({
  server: {
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    ENVIRONMENT: z.enum(['development', 'staging', 'production']).default('development'),
    LOG_LEVEL: z.preprocess(
      (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value),
      z.enum(['silent', 'error', 'warn', 'info', 'debug']).optional(),
    ),
    PORT: port_schema.optional(),
    HOST: z.string().min(1).default('0.0.0.0'),
    API_PORT: port_schema.default(3101),
    API_URL: z.string().url().default('http://localhost:3101'),
    API_PUBLIC_URL: z.string().url().optional(),
    BRAIN_CHANGE_TRIGGERS_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    CONNECTOR_CANARY_APPS: z.string().default(''),
    CONNECTOR_ATTIO_CLIENT_ID: z.string().optional(),
    CONNECTOR_ATTIO_CLIENT_SECRET: z.string().optional(),
    CONNECTOR_GITHUB_CLIENT_ID: z.string().optional(),
    CONNECTOR_GITHUB_CLIENT_SECRET: z.string().optional(),
    CONNECTOR_GMAIL_CLIENT_ID: z.string().optional(),
    CONNECTOR_GMAIL_CLIENT_SECRET: z.string().optional(),
    CONNECTOR_GOOGLE_DRIVE_CLIENT_ID: z.string().optional(),
    CONNECTOR_GOOGLE_DRIVE_CLIENT_SECRET: z.string().optional(),
    CONNECTOR_HUBSPOT_CLIENT_ID: z.string().optional(),
    CONNECTOR_HUBSPOT_CLIENT_SECRET: z.string().optional(),
    CONNECTOR_NOTION_CLIENT_ID: z.string().optional(),
    CONNECTOR_NOTION_CLIENT_SECRET: z.string().optional(),
    CONNECTOR_SALESFORCE_CLIENT_ID: z.string().optional(),
    CONNECTOR_SALESFORCE_CLIENT_SECRET: z.string().optional(),
    CONNECTOR_SLACK_CLIENT_ID: z.string().optional(),
    CONNECTOR_SLACK_CLIENT_SECRET: z.string().optional(),
    DATABASE_URL: z.string().url().optional(),
    ALLOWED_ORIGINS: z.string().default('http://localhost:3000'),
    COWORKER_API_PROXY_SECRET: z.string().min(16).optional(),
    EVENT_JOB_DISPATCH_MODE: z.enum(['in_process', 'http', 'rivet']).default('in_process'),
    RIVET_ENDPOINT: z.string().url().optional(),
    RIVET_NAMESPACE: z.string().min(1).optional(),
    RIVET_TOKEN: z.string().min(1).optional(),
    RIVET_PUBLIC_ENDPOINT: z.string().url().optional(),
    RIVET_CONNECTION_TOKEN: z.string().min(1).optional(),
    RIVET_REGION: z.string().min(1).optional(),
    RIVET_POOL: z.string().min(1).optional(),
    RIVETKIT_RUNTIME_MODE: z.enum(['envoy', 'serverless']).optional(),
    WORKER_SERVERLESS_SECRET: z.string().min(32).optional(),
    WORKER_MAX_CONCURRENT_RUNS: z.coerce.number().int().positive().default(1),
    QUEUE_WORKER_MAX_CONCURRENT_RUNS: z.coerce.number().int().positive().default(8),
    WORKER_MAX_CONCURRENT_CHAT_RUNS: z.coerce.number().int().positive().default(8),
    WORKER_RECOVERY_DISPATCH_CONCURRENCY: z.coerce.number().int().positive().default(16),
    DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
    WORKSPACE_MAX_CONCURRENT_RUNS: z.coerce.number().int().positive().default(2),
    GCP_PROJECT_ID: z.string().min(1).optional(),
    GCP_REGION: z.string().min(1).default('us-central1'),
    ...file_storage_env_schema,
    R2_BUCKET_ENDPOINT: z.string().url().optional(),
    R2_ACCESS_KEY_ID: z.string().min(1).optional(),
    R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    GCP_SCHEDULER_TARGET_BASE_URL: z.string().url().optional(),
    // AWS EventBridge Scheduler backend (recurring + native one-time). Eligible when
    // AWS_SCHEDULER_ROLE_ARN is set and API_URL is an HTTPS non-localhost origin. EventBridge can't
    // POST to our API directly, so it invokes a Lambda (AWS_SCHEDULER_LAMBDA_ARN) that relays to
    // {API_URL}/v1/events/:id with the proxy secret. Cloud Run authenticates to AWS via GCP OIDC ->
    // AssumeRoleWithWebIdentity (no static keys): AWS_AUTH_ROLE_ARN is the role to assume,
    // GCP_OIDC_AUDIENCE the token audience.
    AWS_REGION: z.string().min(1).default('us-west-1'),
    AWS_SCHEDULER_ROLE_ARN: z.string().min(1).optional(),
    SCHEDULER_PROVISIONING: z.enum(['enabled', 'disabled']).default('disabled'),
    AWS_SCHEDULER_LAMBDA_ARN: z.string().min(1).optional(),
    AWS_SCHEDULER_GROUP: z.string().min(1).default('default'),
    AWS_AUTH_ROLE_ARN: z.string().min(1).optional(),
    GCP_OIDC_AUDIENCE: z.string().min(1).optional(),
    PRODUCT_LEGAL_NAME: z.string().optional(),
    APPROVAL_WAIT_WINDOW_MS: z.string().optional(),
    PRODUCT_SUPPORT_EMAIL: z.string().email().optional(),
    PRODUCT_MARKETING_SITE_URL: z.string().url().optional(),
    RESEND_API_KEY: z.string().optional(),
    INBOUND_EMAIL_DOMAIN: z.string().min(3).optional(),
    RESEND_INBOUND_WEBHOOK_SECRET: z.string().optional(),
    EMAIL_DAILY_SEND_LIMIT: z.coerce.number().int().min(1).default(200),
    NOTIFICATIONS_FROM_EMAIL: z.string().default(hosted.notifications_from_email),
    NOTIFICATIONS_REPLY_TO_EMAIL: z.string().email().default(hosted.notifications_reply_to_email),
    NOTIFICATIONS_FOUNDER_FROM_EMAIL: z.string().default(founder_from_email),
    NOTIFICATIONS_FOUNDER_REPLY_TO_EMAIL: z.string().email().default(founder_reply_to_email),
    NEXT_PUBLIC_APP_URL: z.string().url().default(default_app_origin),
    APP_UPGRADE_URL: z.string().url().default(default_app_usage_url),
    SENTRY_DSN: z.string().url().optional(),
    API_SENTRY_DSN: z.string().url().optional(),
    SENTRY_RELEASE: z.string().min(1).optional(),
    SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).optional(),
    ...model_provider_env_schema,
    ...integration_env_schema,
    WORKOS_API_KEY: z.string().optional(),
    WORKOS_WEBHOOK_SECRET: z.string().optional(),
    SLACK_CLIENT_ID: z.string().optional(),
    SLACK_CLIENT_SECRET: z.string().optional(),
    SLACK_SIGNING_SECRET: z.string().optional(),
    SLACK_TEAM_ID: z.string().optional(),
    SLACK_EVAL_APP_URL: z.string().url().optional(),
    SLACK_EVAL_WORKSPACE_NAME: z.string().min(1).optional(),
    SLACK_EVAL_CHANNEL_ID: z
      .string()
      .regex(/^[CGD][A-Z0-9]+$/)
      .optional(),
    SLACK_EVAL_ACTOR_EMAIL: z.string().email().optional(),
    SLACK_EVAL_ACTOR_PASSWORD: z.string().min(1).optional(),
    SLACK_EVAL_BROWSER_COMMAND: z.string().min(1).optional(),
    ...workspace_runtime_env_schema,
    COWORKER_PERSISTENT_WORKSPACES_ENABLED: boolean_env_schema.default(false),
    COWORKER_WORKSPACE_BASE_PATH: z.string().min(1).optional(),
    E2B_API_KEY: z.string().min(1).optional(),
    ARCHIL_API_KEY: z.string().min(1).optional(),
    ARCHIL_REGION: z.string().min(1).optional(),
    R2_BUCKET_NAME: z.string().min(1).optional(),
    VOLUME_BACKUP_BUCKET: z.string().min(1).optional(),
    VOLUME_SNAPSHOTS_ENABLED: boolean_env_schema.default(false),
    // Client ids for the rare authorization server that will not register one
    // dynamically. Keyed by server_key, e.g. {"githubcopilot":"Iv1.abc123"}.
    // Every server that supports RFC 7591 registration needs no entry here, which
    // today is all of them but GitHub.
    COWORKER_MCP_OAUTH_CLIENT_IDS: json_record_env_schema.optional(),
    COWORKER_CREDENTIAL_ENCRYPTION_KEY: z.string().min(1).optional(),
    COWORKER_CREDENTIAL_ENCRYPTION_KEY_FALLBACKS: z.string().optional(),
    COWORKER_BROWSER_STATE_ENCRYPTION_KEY: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/u)
      .optional(),
    COWORKER_ARCHIL_LIVE_TEST_ENABLED: boolean_env_schema.default(false),
    COWORKER_E2B_TEMPLATE_ID: z.string().min(1).default('coworker-nextjs'),
    COWORKER_E2B_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(10 * 60 * 1000),
    COWORKER_E2B_AUTO_PAUSE: boolean_env_schema.default(true),
    COWORKER_BROWSER_COMMAND_TIMEOUT_MS: z.coerce.number().int().positive().default(25_000),
    COWORKER_BROWSER_MODEL_PROXY: z.string().min(1).default('anthropic_direct'),
    COWORKER_BROWSER_MODEL_NAME: z.string().min(1).default('claude-sonnet-5'),
    COWORKER_BROWSER_HARNESS_MODE: z.enum(['off', 'direct', 'subagent']).default('direct'),
    COWORKER_BROWSER_MAX_STEPS: z.coerce.number().int().positive().default(150),
    SANDBOX_PREVIEW_BASE_DOMAIN: z.string().min(1).default(hosted.sandbox_preview_base_domain),
    SANDBOX_PREVIEW_PROTOCOL: z.enum(['https', 'http']).default('https'),
    SANDBOX_PREVIEW_DEFAULT_PORT: port_schema.default(3000),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});

export type ProductBrandConfig = {
  product_brand_name: string;
  product_legal_name?: string;
  product_support_email?: string;
  product_marketing_site_url?: string;
};

export const product_brand_config: ProductBrandConfig = {
  product_brand_name: default_project_display_name,
  ...(env.PRODUCT_LEGAL_NAME ? { product_legal_name: env.PRODUCT_LEGAL_NAME } : {}),
  ...(env.PRODUCT_SUPPORT_EMAIL ? { product_support_email: env.PRODUCT_SUPPORT_EMAIL } : {}),
  ...(env.PRODUCT_MARKETING_SITE_URL
    ? { product_marketing_site_url: env.PRODUCT_MARKETING_SITE_URL }
    : {}),
};

export function require_database_url() {
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for database access');
  }

  return env.DATABASE_URL;
}

export class RivetEndpointMissingError extends Error {
  constructor() {
    super('EVENT_JOB_DISPATCH_MODE=rivet needs RIVET_ENDPOINT, the Rivet Engine to ring.');
    this.name = 'RivetEndpointMissingError';
  }
}

export type RivetConnection = {
  endpoint: string;
  namespace?: string;
  token?: string;
  region?: string;
  pool: string;
};

export function require_rivet_connection(
  config: Pick<
    typeof env,
    'RIVET_ENDPOINT' | 'RIVET_NAMESPACE' | 'RIVET_TOKEN' | 'RIVET_REGION' | 'RIVET_POOL'
  > = env,
): RivetConnection {
  if (!config.RIVET_ENDPOINT) throw new RivetEndpointMissingError();
  return {
    endpoint: config.RIVET_ENDPOINT,
    pool: config.RIVET_POOL ?? 'default',
    ...(config.RIVET_NAMESPACE ? { namespace: config.RIVET_NAMESPACE } : {}),
    ...(config.RIVET_TOKEN ? { token: config.RIVET_TOKEN } : {}),
    ...(config.RIVET_REGION ? { region: config.RIVET_REGION } : {}),
  };
}

export function database_url_or_default() {
  return env.DATABASE_URL ?? default_database_url;
}

export type SentryConfig = {
  dsn: string;
  environment: string;
  release?: string;
  traces_sample_rate?: number;
};

export function connector_canary_app_keys(): string[] {
  return env.CONNECTOR_CANARY_APPS.split(',')
    .map((app_key) => app_key.trim())
    .filter(Boolean);
}

export function read_sentry_config(): SentryConfig | null {
  return build_sentry_config(env.SENTRY_DSN);
}

export function read_api_sentry_config(): SentryConfig | null {
  return build_sentry_config(env.API_SENTRY_DSN ?? env.SENTRY_DSN);
}

function build_sentry_config(dsn: string | undefined): SentryConfig | null {
  if (!dsn) return null;

  const release = env.SENTRY_RELEASE ?? process.env.VERCEL_GIT_COMMIT_SHA;

  return {
    dsn,
    environment: env.ENVIRONMENT,
    ...(release ? { release } : {}),
    ...(env.SENTRY_TRACES_SAMPLE_RATE === undefined
      ? {}
      : { traces_sample_rate: env.SENTRY_TRACES_SAMPLE_RATE }),
  };
}
