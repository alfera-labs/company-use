import type { ApiEnv } from '@api/lib/context';
import { ok } from '@api/lib/response';
import { validate_json } from '@api/lib/validate';
import { read_person_timezone, set_person_timezone } from '@api/services/person_timezone';
import { Hono } from 'hono';
import { z } from 'zod';

const set_timezone_schema = z.strictObject({ timezone: z.string().min(1).max(100) });

export const my_timezone_routes = new Hono<ApiEnv>()
  .get('/v1/me/timezone', async (c) =>
    c.json(ok(await read_person_timezone(c.get('db'), c.get('user_id')))),
  )
  .put('/v1/me/timezone', validate_json(set_timezone_schema), async (c) => {
    const saved = await set_person_timezone(c.get('db'), {
      user_id: c.get('user_id'),
      timezone: c.req.valid('json').timezone,
    });
    return c.json(ok(saved));
  });
