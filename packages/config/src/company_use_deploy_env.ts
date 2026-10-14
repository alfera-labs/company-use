import { z } from 'zod';

const unset_when_blank = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;
const optional_text = z.preprocess(unset_when_blank, z.string().optional());
const optional_url = z.preprocess(unset_when_blank, z.string().url().optional());

const company_use_deploy_env_schema = z.object({
  COMPANY_USE_DEPLOY_PAGE_ORIGINS: optional_text,
  COMPANY_USE_DIGITALOCEAN_CLIENT_ID: optional_text,
  COMPANY_USE_VERSION: optional_text,
  COMPANY_USE_AWS_TEMPLATE_URL: optional_url,
  COMPANY_USE_TEST_OVERRIDES: z.preprocess(unset_when_blank, z.enum(['allowed']).optional()),
  VERCEL_ENV: optional_text,
});

export type CompanyUseDeployEnv = {
  page_origins: string[];
  digitalocean_client_id: string | null;
  version: string | null;
  aws_template_url: string | null;
  allows_test_overrides: boolean;
};

const origin_of = (value: string) => URL.parse(value)?.origin ?? null;

function read_page_origins(list: string | undefined): string[] {
  const origins = (list ?? '').split(',').map((value) => origin_of(value.trim()));
  return origins.filter((origin): origin is string => Boolean(origin));
}

export function read_company_use_deploy_env(): CompanyUseDeployEnv {
  const values = company_use_deploy_env_schema.parse(process.env);
  const is_production_site = values.VERCEL_ENV === 'production';
  return {
    page_origins: read_page_origins(values.COMPANY_USE_DEPLOY_PAGE_ORIGINS),
    digitalocean_client_id: values.COMPANY_USE_DIGITALOCEAN_CLIENT_ID ?? null,
    version: values.COMPANY_USE_VERSION ?? (is_production_site ? null : 'main'),
    aws_template_url: values.COMPANY_USE_AWS_TEMPLATE_URL ?? null,
    allows_test_overrides: values.COMPANY_USE_TEST_OVERRIDES === 'allowed' && !is_production_site,
  };
}

export function read_deploy_page_config(api_url: string) {
  const env = read_company_use_deploy_env();
  return {
    digitalocean_client_id: env.digitalocean_client_id,
    version: env.version,
    aws_template_url: env.aws_template_url,
    allows_test_overrides: env.allows_test_overrides,
    api_origin: new URL(api_url).origin,
  };
}
