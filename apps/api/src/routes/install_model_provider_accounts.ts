import type { ApiEnv } from '@api/lib/context';
import { ok } from '@api/lib/response';
import { only_in_team_mode, team_admins_only_write } from '@api/lib/team_mode_routes';
import { validate_json } from '@api/lib/validate';
import {
  check_install_ai_key,
  disconnect_install_ai_key,
  list_install_ai_connections,
  redeem_install_chatgpt_sign_in,
  save_install_ai_values,
  start_install_chatgpt_sign_in,
} from '@api/services/install/install_ai_connections';
import { Hono } from 'hono';
import { z } from 'zod';

const install_ai_key_schema = z.strictObject({
  api_key: z.string().trim().min(1).max(500),
  provider_slot: z.string().trim().min(1).max(40).optional(),
});

const chatgpt_finish_schema = z.strictObject({
  sign_in_attempt: z.string().min(1).max(4000),
  callback_url: z.string().trim().min(1).max(4000),
});

const path = '/v1/install/model-provider-accounts';

export const install_model_provider_account_routes = new Hono<ApiEnv>()
  .use(
    `${path}/*`,
    only_in_team_mode,
    team_admins_only_write('Only an owner or an admin can change the AI keys of this server.'),
  )
  .use(
    path,
    only_in_team_mode,
    team_admins_only_write('Only an owner or an admin can change the AI keys of this server.'),
  )
  .get(path, async (c) => c.json(ok({ accounts: await list_install_ai_connections(c.get('db')) })))
  .put(path, validate_json(install_ai_key_schema), async (c) => {
    const checked = await check_install_ai_key(c.req.valid('json'));
    return c.json(
      ok(await save_install_ai_values(c.get('db'), { ...checked, actor_id: c.get('user_id') })),
    );
  })
  .post(`${path}/chatgpt/start`, (c) =>
    c.json(ok(start_install_chatgpt_sign_in(`install:${c.get('user_id')}`))),
  )
  .post(`${path}/chatgpt/finish`, validate_json(chatgpt_finish_schema), async (c) => {
    const checked = await redeem_install_chatgpt_sign_in({
      ...c.req.valid('json'),
      bound_to: `install:${c.get('user_id')}`,
    });
    return c.json(
      ok(await save_install_ai_values(c.get('db'), { ...checked, actor_id: c.get('user_id') })),
    );
  })
  .delete(`${path}/:provider_slot`, async (c) =>
    c.json(ok(await disconnect_install_ai_key(c.get('db'), c.req.param('provider_slot')))),
  );
