import type { ApiEnv } from '@api/lib/context';
import { ok } from '@api/lib/response';
import { validate_json, validate_query } from '@api/lib/validate';
import { validate_trigger_agent_and_job_input } from '@api/routes/scheduled_task_input';
import {
  create_trigger_without_secrets,
  delete_workspace_trigger,
  list_triggers_without_secrets,
  list_workspace_trigger_runs,
  mark_workspace_trigger_runs_read,
  run_workspace_trigger,
  update_trigger_without_secrets,
} from '@api/services/triggers';
import {
  drop_server_owned_config_keys,
  drop_wire_config_keys,
} from '@api/services/triggers/trigger_config_ownership';
import { NotFoundError } from '@coworker/shared';
import { Hono } from 'hono';
import { z } from 'zod';

const trigger_object_schema = z.record(z.string(), z.unknown());

const cron_field_ranges: ReadonlyArray<[number, number]> = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7], // day of week (0 and 7 are both Sunday)
];

export function is_valid_cron(expression: string) {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== cron_field_ranges.length) return false;
  if (!fields.every((field, index) => is_valid_cron_field(field, cron_field_ranges[index]))) {
    return false;
  }
  // Reject shapes a cron-only-to-AWS translation can't represent, so they fail here with a 422
  // instead of provisioning-time 500s: AWS can't constrain BOTH day-of-month and day-of-week, and
  // can't remap a stepped day-of-week. The visual builder never produces either.
  const [, , day_of_month = '', , day_of_week = ''] = fields;
  if (day_of_month !== '*' && day_of_week !== '*') return false;
  if (day_of_week.includes('/')) return false;
  return true;
}

function is_valid_cron_field(field: string, bounds: [number, number] | undefined) {
  if (!bounds) return false;
  return field.split(',').every((part) => is_valid_cron_part(part, bounds));
}

function is_valid_cron_part(part: string, [min, max]: [number, number]) {
  const [range, step] = part.split('/');
  if (step !== undefined && !(Number(step) >= 1)) return false;
  if (range === '*') return true;
  const [start, end] = (range ?? '').split('-');
  const start_value = Number(start);
  if (!Number.isInteger(start_value) || start_value < min || start_value > max) return false;
  if (end === undefined) return true;
  const end_value = Number(end);
  return Number.isInteger(end_value) && end_value >= start_value && end_value <= max;
}

const create_trigger_schema = z
  .object({
    trigger_name: z.string().min(1).max(160),
    trigger_type: z.enum(['schedule', 'webhook', 'app_event', 'manual', 'system_event']),
    node_id: z.string().min(1).nullable().optional(),
    trigger_config: trigger_object_schema.optional(),
    trigger_source: trigger_object_schema.optional(),
    trigger_target: trigger_object_schema.optional(),
    schedule_expression: z.string().min(1).nullable().optional(),
    agent_id: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.trigger_type !== 'schedule') return;
    if (!value.schedule_expression || !is_valid_cron(value.schedule_expression)) {
      ctx.addIssue({
        code: 'custom',
        path: ['schedule_expression'],
        message: 'A schedule trigger needs a valid 5-field cron expression.',
      });
    }
    const run_once_at = value.trigger_config?.run_once_at;
    if (typeof run_once_at === 'string' && !is_future_instant(run_once_at)) {
      ctx.addIssue({
        code: 'custom',
        path: ['trigger_config', 'run_once_at'],
        message: 'A one-time task must be scheduled for a time in the future.',
      });
    }
  });

function is_future_instant(iso: string): boolean {
  const ms = Date.parse(iso);
  return !Number.isNaN(ms) && ms > Date.now() + 60_000;
}

const update_trigger_schema = z
  .object({
    trigger_name: z.string().min(1).max(160).optional(),
    trigger_status: z.enum(['enabled', 'disabled', 'error']).optional(),
    agent_id: z.string().min(1).optional(),
    trigger_type: z.enum(['schedule', 'manual']).optional(),
    trigger_config: trigger_object_schema.optional(),
    trigger_source: trigger_object_schema.optional(),
    trigger_target: trigger_object_schema.optional(),
    schedule_expression: z.string().min(1).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (!has_update_field(value)) {
      ctx.addIssue({ code: 'custom', message: 'At least one trigger field must be updated.' });
    }
    if (value.schedule_expression && !is_valid_cron(value.schedule_expression)) {
      ctx.addIssue({
        code: 'custom',
        path: ['schedule_expression'],
        message: 'A schedule trigger needs a valid 5-field cron expression.',
      });
    }
    const run_once_at = value.trigger_config?.run_once_at;
    if (typeof run_once_at === 'string' && !is_future_instant(run_once_at)) {
      ctx.addIssue({
        code: 'custom',
        path: ['trigger_config', 'run_once_at'],
        message: 'A one-time task must be scheduled for a time in the future.',
      });
    }
  });

const run_trigger_schema = z.object({ occurrence_key: z.string().min(1).max(120) }).strict();
const trigger_runs_query_schema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    page_size: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

function has_update_field(value: Record<string, unknown>) {
  return Object.keys(value).length > 0;
}

export const trigger_routes = new Hono<ApiEnv>()
  .get('/v1/triggers', async (c) => {
    return c.json(ok(await list_triggers_without_secrets(c.get('db'), c.get('workspace_id'))));
  })
  .get('/v1/triggers/:trigger_id/runs', validate_query(trigger_runs_query_schema), async (c) => {
    const query = c.req.valid('query');
    return c.json(
      ok(
        await list_workspace_trigger_runs(c.get('db'), {
          workspace_id: c.get('workspace_id'),
          trigger_id: c.req.param('trigger_id'),
          reader_id: c.get('user_id'),
          ...query,
        }),
      ),
    );
  })
  .post('/v1/triggers/:trigger_id/runs/read', async (c) => {
    return c.json(
      ok(
        await mark_workspace_trigger_runs_read(c.get('db'), {
          workspace_id: c.get('workspace_id'),
          trigger_id: c.req.param('trigger_id'),
          reader_id: c.get('user_id'),
        }),
      ),
    );
  })
  .post('/v1/triggers', validate_json(create_trigger_schema), async (c) => {
    const raw_body = c.req.valid('json');
    const body = {
      ...raw_body,
      ...(raw_body.trigger_config
        ? { trigger_config: drop_wire_config_keys(raw_body.trigger_config) }
        : {}),
    };
    const agent_id = body.agent_id ?? c.get('agent_id');
    await validate_trigger_agent_and_job_input({
      db: c.get('db'),
      workspace_id: c.get('workspace_id'),
      ...(body.agent_id ? { agent_id: body.agent_id } : {}),
      ...(body.agent_id ? { agent_id } : {}),
      ...(body.trigger_config ? { trigger_config: body.trigger_config } : {}),
    });
    const trigger = await create_trigger_without_secrets(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      agent_id,
      ...(body.node_id !== undefined ? { node_id: body.node_id } : {}),
      trigger_name: body.trigger_name,
      trigger_type: body.trigger_type,
      ...(body.trigger_config ? { trigger_config: body.trigger_config } : {}),
      ...(body.trigger_source ? { trigger_source: body.trigger_source } : {}),
      ...(body.trigger_target ? { trigger_target: body.trigger_target } : {}),
      ...(body.schedule_expression !== undefined
        ? { schedule_expression: body.schedule_expression }
        : {}),
      actor_id: c.get('user_id'),
    });
    return c.json(ok(trigger), 201);
  })
  .post('/v1/triggers/:trigger_id/run', validate_json(run_trigger_schema), async (c) => {
    return c.json(
      ok(
        await run_workspace_trigger(c.get('db'), {
          workspace_id: c.get('workspace_id'),
          trigger_id: c.req.param('trigger_id'),
          occurrence_key: c.req.valid('json').occurrence_key,
        }),
      ),
      202,
    );
  })
  .patch('/v1/triggers/:trigger_id', validate_json(update_trigger_schema), async (c) => {
    const raw_body = c.req.valid('json');
    const body = {
      ...raw_body,
      ...(raw_body.trigger_config
        ? { trigger_config: drop_server_owned_config_keys(raw_body.trigger_config) }
        : {}),
    };
    await validate_trigger_agent_and_job_input({
      db: c.get('db'),
      workspace_id: c.get('workspace_id'),
      ...(body.agent_id ? { agent_id: body.agent_id } : {}),
      ...(body.trigger_config ? { trigger_config: body.trigger_config } : {}),
    });
    const trigger = await update_trigger_without_secrets(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      trigger_id: c.req.param('trigger_id'),
      ...(body.trigger_name === undefined ? {} : { trigger_name: body.trigger_name }),
      ...(body.trigger_status === undefined ? {} : { trigger_status: body.trigger_status }),
      ...(body.agent_id === undefined ? {} : { agent_id: body.agent_id }),
      ...(body.trigger_type === undefined ? {} : { trigger_type: body.trigger_type }),
      ...(body.trigger_config === undefined ? {} : { trigger_config: body.trigger_config }),
      ...(body.trigger_source === undefined ? {} : { trigger_source: body.trigger_source }),
      ...(body.trigger_target === undefined ? {} : { trigger_target: body.trigger_target }),
      ...(body.schedule_expression === undefined
        ? {}
        : { schedule_expression: body.schedule_expression }),
      actor_id: c.get('user_id'),
    });
    return c.json(ok(trigger));
  })
  .delete('/v1/triggers/:trigger_id', async (c) => {
    const trigger = await delete_workspace_trigger(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      trigger_id: c.req.param('trigger_id'),
    });
    if (!trigger) throw new NotFoundError('Trigger');

    return c.json(ok({ trigger_id: trigger.trigger_id, deleted: true }));
  });
