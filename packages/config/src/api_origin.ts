import { public_env } from '@coworker/config/public_env';

export function read_api_origin(): string {
  return process.env.API_URL ?? public_env.NEXT_PUBLIC_API_URL;
}
