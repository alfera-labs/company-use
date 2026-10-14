import { default_project_display_name, local_app_origin } from '@coworker/config/constants';
import { marketing_site_origin } from '@coworker/config/hosted_defaults';
import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

const sample_rate_schema = z.coerce.number().min(0).max(1);

export const public_env = createEnv({
  clientPrefix: 'NEXT_PUBLIC_',
  client: {
    NEXT_PUBLIC_ENVIRONMENT: z
      .enum(['development', 'staging', 'production'])
      .default('development'),
    NEXT_PUBLIC_API_URL: z.string().url().default('http://localhost:3101'),
    NEXT_PUBLIC_APP_URL: z.string().url().default(local_app_origin),
    NEXT_PUBLIC_MARKETING_URL: z.string().url().default(marketing_site_origin),
    NEXT_PUBLIC_WORKOS_REDIRECT_URI: z.string().url().optional(),
    NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional(),
    NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: sample_rate_schema.optional(),
  },
  runtimeEnv: {
    NEXT_PUBLIC_ENVIRONMENT: process.env.NEXT_PUBLIC_ENVIRONMENT,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_MARKETING_URL: process.env.NEXT_PUBLIC_MARKETING_URL,
    NEXT_PUBLIC_WORKOS_REDIRECT_URI: process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
    NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
  },
  emptyStringAsUndefined: true,
});

export type PublicBrandConfig = {
  product_brand_name: string;
};

export type PublicSentryConfig = {
  dsn: string;
  environment: string;
  traces_sample_rate?: number;
};

export const public_brand_config: PublicBrandConfig = {
  product_brand_name: default_project_display_name,
};

export function read_public_sentry_config(): PublicSentryConfig | null {
  if (!public_env.NEXT_PUBLIC_SENTRY_DSN) return null;

  return {
    dsn: public_env.NEXT_PUBLIC_SENTRY_DSN,
    environment: public_env.NEXT_PUBLIC_ENVIRONMENT,
    ...(public_env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE === undefined
      ? {}
      : { traces_sample_rate: public_env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE }),
  };
}
