import { public_env } from '@coworker/config/public_env';
import { createServerFn } from '@tanstack/react-start';

export const read_public_api_origin = createServerFn({ method: 'GET' }).handler(
  () => public_env.NEXT_PUBLIC_API_URL,
);
