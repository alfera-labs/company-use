import type { ApiEnv } from '@api/lib/context';
import { ok } from '@api/lib/response';
import { validate_json } from '@api/lib/validate';
import { api_key_memory_scope_routes } from '@api/routes/api_key_memory_scopes';
import {
  all_api_key_scopes,
  list_workspace_api_keys_for_user,
  mint_workspace_api_key,
  revoke_workspace_api_key,
} from '@api/services/api_keys';
import { type Context, Hono } from 'hono';
import { z } from 'zod';

const mint_body_schema = z
  .object({
    key_name: z.string().min(1).max(120),
    scopes: z.array(z.enum(all_api_key_scopes)).min(1),
    key_audience: z.enum(['internal', 'external']).default('internal'),
    expires_time: z.iso
      .datetime({ offset: true })
      .transform((value) => new Date(value))
      .refine((date) => date.getTime() > Date.now(), 'expires_time must be in the future')
      .optional(),
  })
  .strict();

type MintBody = z.infer<typeof mint_body_schema>;

export const api_key_routes = new Hono<ApiEnv>()
  .post('/v1/api-keys', validate_json(mint_body_schema), mint_key)
  .get('/v1/api-keys', list_keys)
  .post('/v1/api-keys/:api_key_id/revoke', revoke_key)
  .route('/', api_key_memory_scope_routes);

async function mint_key(
  c: Context<ApiEnv, '/v1/api-keys', { in: { json: MintBody }; out: { json: MintBody } }>,
) {
  const body = c.req.valid('json');
  const minted = await mint_workspace_api_key(c.get('db'), {
    workspace_id: c.get('workspace_id'),
    user_id: c.get('user_id'),
    ...body,
  });
  return c.json(ok(minted), 201);
}

async function list_keys(c: Context<ApiEnv>) {
  const keys = await list_workspace_api_keys_for_user(c.get('db'), {
    workspace_id: c.get('workspace_id'),
    user_id: c.get('user_id'),
  });
  return c.json(ok(keys));
}

async function revoke_key(c: Context<ApiEnv, '/v1/api-keys/:api_key_id/revoke'>) {
  const key = await revoke_workspace_api_key(c.get('db'), {
    workspace_id: c.get('workspace_id'),
    api_key_id: c.req.param('api_key_id'),
    user_id: c.get('user_id'),
  });
  return c.json(ok(key));
}
