import type { ApiEnv } from '@api/lib/context';
import { ok } from '@api/lib/response';
import { validate_json } from '@api/lib/validate';
import {
  connect_workspace_model_key,
  finish_workspace_chatgpt_sign_in,
  start_workspace_chatgpt_sign_in,
} from '@api/services/models/workspace_ai_connections';
import { require_paid_plan } from '@api/services/paywall';
import { authorize_model_provider_account_administration } from '@api/services/workspace_admin_access';
import { type Context, Hono } from 'hono';
import { z } from 'zod';

const connect_api_key_schema = z
  .object({
    api_key: z.string().trim().min(1).max(4096),
    provider_slot: z.string().trim().min(1).optional(),
  })
  .strict();

const finish_chatgpt_sign_in_schema = z
  .object({
    sign_in_attempt: z.string().trim().min(1),
    callback_url: z.string().trim().min(1).max(8192),
  })
  .strict();

export const model_provider_connection_routes = new Hono<ApiEnv>()
  .post(
    '/v1/workspace/model-provider-accounts/api-key',
    validate_json(connect_api_key_schema),
    async (c) => {
      const actor = await authorize_connection(c);
      return c.json(ok(await connect_workspace_model_key(actor, c.req.valid('json'))));
    },
  )
  .post('/v1/workspace/model-provider-accounts/chatgpt/sign-in', async (c) => {
    const actor = await authorize_connection(c);
    return c.json(ok(await start_workspace_chatgpt_sign_in(actor)));
  })
  .post(
    '/v1/workspace/model-provider-accounts/chatgpt/sign-in/finish',
    validate_json(finish_chatgpt_sign_in_schema),
    async (c) => {
      const actor = await authorize_connection(c);
      return c.json(ok(await finish_workspace_chatgpt_sign_in(actor, c.req.valid('json'))));
    },
  );

async function authorize_connection(c: Context<ApiEnv>) {
  const actor = {
    db: c.get('db'),
    workspace_id: c.get('workspace_id'),
    actor_id: c.get('user_id'),
  };
  await authorize_model_provider_account_administration(actor.db, {
    workspace_id: actor.workspace_id,
    user_id: actor.actor_id,
  });
  await require_paid_plan(actor.db, actor.workspace_id, 'Bringing your own AI');
  return actor;
}
