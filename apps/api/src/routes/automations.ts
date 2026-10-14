import type { ApiEnv } from '@api/lib/context';
import { ok } from '@api/lib/response';
import { validate_json, validate_query } from '@api/lib/validate';
import { is_valid_cron } from '@api/routes/triggers';
import {
  create_automation_input_schema,
  update_automation_input_schema,
} from '@api/services/automations/automation_input';
import {
  create_workspace_automation,
  delete_workspace_automation,
  get_workspace_automation,
  list_workspace_automations,
  provision_workspace_automation,
} from '@api/services/automations/automation_service';
import { list_workspace_trigger_types } from '@api/services/automations/automation_trigger_types';
import { edit_workspace_automation } from '@api/services/automations/edit_automation';
import { run_workspace_automation_now } from '@api/services/automations/run_automation_now';
import { list_automation_fire_page } from '@coworker/core/db/queries/automation_fires';
import { list_automation_run_page } from '@coworker/core/db/queries/automation_runs';
import { hide_webhook_secrets_of_triggers } from '@runtime-platform/triggers/trigger_webhook_secret';
import { Hono } from 'hono';
import { z } from 'zod';

export function refuse_bad_crons(
  value: { triggers?: { kind: string; cron?: string }[] | undefined },
  ctx: z.RefinementCtx,
) {
  (value.triggers ?? []).forEach((trigger, index) => {
    if (trigger.kind !== 'schedule' || is_valid_cron(trigger.cron ?? '')) return;
    ctx.addIssue({
      code: 'custom',
      path: ['triggers', index, 'cron'],
      message: 'A schedule trigger needs a valid 5-field cron expression.',
    });
  });
}

const create_automation_body_schema = create_automation_input_schema
  .omit({ workspace_id: true, agent_id: true, actor_id: true, created_via: true, gathering: true })
  .extend({ agent_id: z.string().min(1).optional() })
  .superRefine(refuse_bad_crons);

export const update_automation_body_schema = update_automation_input_schema
  .omit({ workspace_id: true, automation_id: true, actor_id: true, gathering: true })
  .extend({ automation_status: z.enum(['enabled', 'paused']).optional() })
  .refine(
    (value) => Object.keys(value).length > 0,
    'At least one automation field must be updated.',
  )
  .superRefine(refuse_bad_crons);

const run_now_body_schema = z.object({ occurrence_key: z.string().min(1).max(120) }).strict();

const automation_runs_query_schema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    page_size: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export const automation_routes = new Hono<ApiEnv>()
  .get('/v1/automations', async (c) => {
    const automations = await list_workspace_automations(c.get('db'), c.get('workspace_id'));
    return c.json(ok(automations.map(hide_webhook_secrets_of_triggers)));
  })
  // The picker's rows: every trigger node in the catalog, grouped by app. Registered before the
  // `:automation_id` reads so "trigger-types" is never mistaken for an id.
  .get('/v1/automations/trigger-types', async (c) => {
    const identity = { workspace_id: c.get('workspace_id'), user_id: c.get('user_id') };
    return c.json(ok(await list_workspace_trigger_types(c.get('db'), identity)));
  })
  .post('/v1/automations', validate_json(create_automation_body_schema), async (c) => {
    const body = c.req.valid('json');
    const created = await create_workspace_automation(c.get('db'), {
      ...body,
      workspace_id: c.get('workspace_id'),
      agent_id: body.agent_id ?? c.get('agent_id'),
      actor_id: c.get('user_id'),
      created_via: 'user',
    });
    return c.json(ok(hide_webhook_secrets_of_triggers(created)), 201);
  })
  .get(
    '/v1/automations/:automation_id/runs',
    validate_query(automation_runs_query_schema),
    async (c) => {
      return c.json(
        ok(
          await list_automation_run_page(c.get('db'), {
            workspace_id: c.get('workspace_id'),
            automation_id: c.req.param('automation_id'),
            reader_id: c.get('user_id'),
            ...c.req.valid('query'),
          }),
        ),
      );
    },
  )
  .get(
    '/v1/automations/:automation_id/fires',
    validate_query(automation_runs_query_schema),
    async (c) => {
      return c.json(
        ok(
          await list_automation_fire_page(c.get('db'), {
            workspace_id: c.get('workspace_id'),
            automation_id: c.req.param('automation_id'),
            ...c.req.valid('query'),
          }),
        ),
      );
    },
  )
  .post('/v1/automations/:automation_id/run-now', validate_json(run_now_body_schema), async (c) => {
    const fired = await run_workspace_automation_now(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      automation_id: c.req.param('automation_id'),
      occurrence_key: c.req.valid('json').occurrence_key,
      actor_id: c.get('user_id'),
    });
    return c.json(ok(fired), 202);
  })
  .get('/v1/automations/:automation_id', async (c) => {
    const read = await get_workspace_automation(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      automation_id: c.req.param('automation_id'),
    });
    return c.json(ok(hide_webhook_secrets_of_triggers(read)));
  })
  .patch(
    '/v1/automations/:automation_id',
    validate_json(update_automation_body_schema),
    async (c) => {
      const edited = await edit_workspace_automation(c.get('db'), {
        ...c.req.valid('json'),
        workspace_id: c.get('workspace_id'),
        automation_id: c.req.param('automation_id'),
        actor_id: c.get('user_id'),
      });
      return c.json(ok(hide_webhook_secrets_of_triggers(edited)));
    },
  )
  .post('/v1/automations/:automation_id/provision', async (c) => {
    const provisioned = await provision_workspace_automation(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      automation_id: c.req.param('automation_id'),
      actor_id: c.get('user_id'),
    });
    return c.json(ok(hide_webhook_secrets_of_triggers(provisioned)));
  })
  .delete('/v1/automations/:automation_id', async (c) => {
    const deleted = await delete_workspace_automation(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      automation_id: c.req.param('automation_id'),
      actor_id: c.get('user_id'),
    });
    return c.json(
      ok({
        automation_id: deleted.automation.automation_id,
        deleted: true,
        triggers: deleted.triggers,
      }),
    );
  });
