import { read_client_address } from '@api/lib/client_address';
import type { ApiEnv } from '@api/lib/context';
import { machine_caller_only } from '@api/lib/machine_caller';
import { ok } from '@api/lib/response';
import { email_schema, new_password_schema } from '@api/lib/sign_in_fields';
import { only_in_team_mode } from '@api/lib/team_mode_routes';
import { validate_json } from '@api/lib/validate';
import {
  type CheckedInstallAiValues,
  check_install_ai_key,
  list_install_ai_connections,
  redeem_install_chatgpt_sign_in,
  save_install_ai_values,
  start_install_chatgpt_sign_in,
} from '@api/services/install/install_ai_connections';
import { create_install_owner, setup_actor } from '@api/services/install/install_owner_setup';
import {
  require_setup_token,
  setup_token_binding,
  while_setup_is_open,
} from '@api/services/install/setup_token';
import { type Context, Hono } from 'hono';
import { z } from 'zod';

const setup_token_schema = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);

const setup_check_schema = z.strictObject({ setup_token: setup_token_schema });
const setup_ai_key_schema = z.strictObject({
  setup_token: setup_token_schema,
  api_key: z.string().trim().min(1).max(500),
  provider_slot: z.string().trim().min(1).max(40).optional(),
});
const setup_chatgpt_finish_schema = z.strictObject({
  setup_token: setup_token_schema,
  sign_in_attempt: z.string().min(1).max(4000),
  callback_url: z.string().trim().min(1).max(4000),
});
const setup_owner_schema = z.strictObject({
  setup_token: setup_token_schema,
  email: email_schema,
  password: new_password_schema,
  first_name: z.string().trim().min(1).max(80).optional(),
});

function check_setup_token(c: Context<ApiEnv>, setup_token: string) {
  return require_setup_token(c.get('db'), { setup_token, client_address: read_client_address(c) });
}

function save_while_setup_is_open(c: Context<ApiEnv>, checked: CheckedInstallAiValues) {
  return while_setup_is_open(c.get('db'), (tx) =>
    save_install_ai_values(tx, { ...checked, actor_id: setup_actor }),
  );
}

export const install_setup_routes = new Hono<ApiEnv>()
  .use('/v1/setup/*', only_in_team_mode, machine_caller_only)
  .post('/v1/setup/check', validate_json(setup_check_schema), async (c) => {
    await check_setup_token(c, c.req.valid('json').setup_token);
    return c.json(ok({ ai_connections: await list_install_ai_connections(c.get('db')) }));
  })
  .post('/v1/setup/ai-key', validate_json(setup_ai_key_schema), async (c) => {
    const { setup_token, ...key } = c.req.valid('json');
    await check_setup_token(c, setup_token);
    return c.json(ok(await save_while_setup_is_open(c, await check_install_ai_key(key))));
  })
  .post('/v1/setup/chatgpt/start', validate_json(setup_check_schema), async (c) => {
    const { setup_token } = c.req.valid('json');
    await check_setup_token(c, setup_token);
    return c.json(ok(start_install_chatgpt_sign_in(setup_token_binding(setup_token))));
  })
  .post('/v1/setup/chatgpt/finish', validate_json(setup_chatgpt_finish_schema), async (c) => {
    const { setup_token, ...finish } = c.req.valid('json');
    await check_setup_token(c, setup_token);
    const checked = await redeem_install_chatgpt_sign_in({
      ...finish,
      bound_to: setup_token_binding(setup_token),
    });
    return c.json(ok(await save_while_setup_is_open(c, checked)));
  })
  .post('/v1/setup/owner', validate_json(setup_owner_schema), async (c) => {
    const { setup_token, ...owner } = c.req.valid('json');
    await check_setup_token(c, setup_token);
    return c.json(ok(await create_install_owner(c.get('db'), owner)), 201);
  });
