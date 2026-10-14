import { env } from '@coworker/config';
import { normalize_origin } from '@coworker/config/env_value_schemas';

export type CorsOriginConfig = {
  ALLOWED_ORIGINS: string;
  API_PUBLIC_URL?: string | undefined;
  API_URL: string;
};

export function allowed_cors_origins(config: CorsOriginConfig = env): string[] {
  const configured = config.ALLOWED_ORIGINS.split(',').map(normalize_origin);
  const own_origins = [config.API_PUBLIC_URL, config.API_URL].map(origin_of);
  return unique([...configured, ...own_origins].filter(is_present));
}

function origin_of(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return URL.parse(value)?.origin;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function is_present(value: string | undefined): value is string {
  return Boolean(value && value.length > 0);
}
