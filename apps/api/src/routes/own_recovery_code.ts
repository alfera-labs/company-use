import type { ApiEnv } from '@api/lib/context';
import { ok } from '@api/lib/response';
import { password_schema } from '@api/lib/sign_in_fields';
import { only_in_team_mode } from '@api/lib/team_mode_routes';
import { validate_json } from '@api/lib/validate';
import { attach_workspace } from '@api/middleware';
import {
  make_new_recovery_code,
  person_has_a_password,
} from '@api/services/team/recovery_code_renewal';
import { Hono } from 'hono';
import { z } from 'zod';

const path = '/v1/sign-in-password';
const new_recovery_code_schema = z.strictObject({ password: password_schema });

export const own_recovery_code_routes = new Hono<ApiEnv>()
  .use(path, only_in_team_mode, attach_workspace())
  .use(`${path}/*`, only_in_team_mode, attach_workspace())
  .get(path, async (c) =>
    c.json(ok({ has_password: await person_has_a_password(c.get('db'), c.get('user_id')) })),
  )
  .post(`${path}/recovery-code`, validate_json(new_recovery_code_schema), async (c) => {
    const made = await make_new_recovery_code(c.get('db'), {
      user_id: c.get('user_id'),
      password: c.req.valid('json').password,
    });
    return c.json(ok(made), 201);
  });
