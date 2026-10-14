import type { Context } from 'hono';

export function request_carries_api_key(c: Context): boolean {
  const bearer = c.req.header('authorization');
  if (bearer?.toLowerCase().startsWith('bearer ')) return true;
  return Boolean(c.req.header('x-api-key'));
}
