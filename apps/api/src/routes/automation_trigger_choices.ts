import type { ApiEnv } from '@api/lib/context';
import { error_body, ok } from '@api/lib/response';
import { validate_query } from '@api/lib/validate';
import { list_trigger_field_choices } from '@api/services/automations/trigger_field_choices';
import { Hono } from 'hono';
import { z } from 'zod';

const params_schema = z.object({ node_key: z.string().min(1), field: z.string().min(1) });
const query_schema = z.object({ connection_id: z.string().min(1) }).strict();

export const automation_trigger_choice_routes = new Hono<ApiEnv>().get(
  '/v1/automations/trigger-types/:node_key/fields/:field/choices',
  validate_query(query_schema),
  async (c) => {
    const params = params_schema.parse(c.req.param());
    const result = await list_trigger_field_choices(c.get('db'), {
      ...params,
      connection_id: c.req.valid('query').connection_id,
      workspace_id: c.get('workspace_id'),
      actor_id: c.get('user_id'),
    });
    if (result.status === 'missing') return c.json(error_body('not_found', result.message), 404);
    if (result.status === 'access_denied')
      return c.json(error_body('access_denied', result.message), 403);
    if (result.status === 'provider_error')
      return c.json(error_body('provider_error', result.message), 502);
    return c.json(ok({ choices: result.choices }));
  },
);
