import { read_client_address } from '@api/lib/client_address';
import type { ApiEnv } from '@api/lib/context';
import { machine_caller_only } from '@api/lib/machine_caller';
import { ok } from '@api/lib/response';
import {
  email_schema,
  new_password_schema,
  password_schema,
  recovery_code_schema,
} from '@api/lib/sign_in_fields';
import { only_in_team_mode } from '@api/lib/team_mode_routes';
import { validate_json } from '@api/lib/validate';
import { read_install_sign_in_state } from '@api/services/install/setup_token';
import {
  reset_password_with_recovery_code,
  sign_in_with_password,
} from '@api/services/team/team_password_sign_in';
import { AppError } from '@coworker/shared';
import { Hono } from 'hono';
import { z } from 'zod';

const password_sign_in_schema = z.strictObject({ email: email_schema, password: password_schema });
const password_recovery_schema = z.strictObject({
  email: email_schema,
  recovery_code: recovery_code_schema,
  new_password: new_password_schema,
});

const path = '/v1/team-sign-in/password';

export const team_password_sign_in_routes = new Hono<ApiEnv>()
  .use(path, only_in_team_mode, machine_caller_only)
  .use(`${path}/*`, only_in_team_mode, machine_caller_only)
  .get(`${path}/state`, async (c) => c.json(ok(await read_install_sign_in_state(c.get('db')))))
  .post(path, validate_json(password_sign_in_schema), async (c) => {
    const session = await sign_in_with_password(c.get('db'), {
      ...c.req.valid('json'),
      client_address: read_client_address(c),
    });
    if (!session) {
      throw new AppError('sign_in_refused', 'That email and password do not match', 401);
    }
    return c.json(ok(session), 201);
  })
  .post(`${path}/recover`, validate_json(password_recovery_schema), async (c) => {
    const recovered = await reset_password_with_recovery_code(c.get('db'), {
      ...c.req.valid('json'),
      client_address: read_client_address(c),
    });
    if (!recovered) {
      throw new AppError('recovery_refused', 'That email and recovery code do not match', 401);
    }
    return c.json(ok(recovered), 201);
  });
