import type { ApiEnv } from '@api/lib/context';
import { verify_machine_caller } from '@api/lib/proxy_identity';
import { ok } from '@api/lib/response';
import { parse_json_text } from '@api/lib/validate';
import { fire_trigger } from '@api/services/triggers/fire_trigger';
import { get_trigger_by_id } from '@coworker/core/db/queries/trigger_reads';
import { uses_rivet_event_job_dispatch } from '@coworker/jobs';
import { NotFoundError } from '@coworker/shared';
import { type Context, Hono } from 'hono';
import { z } from 'zod';

export const event_routes = new Hono<ApiEnv>();

const fire_body_schema = z
  .object({ occurrence_key: z.string().min(1).max(120).optional() })
  .optional();

async function fire_trigger_by_id(c: Context<ApiEnv>) {
  verify_machine_caller(c);
  const trigger_id = c.req.param('trigger_id');
  if (!trigger_id) throw new NotFoundError('Trigger');

  const trigger = await get_trigger_by_id(c.get('db'), trigger_id);
  if (!trigger) throw new NotFoundError('Trigger');
  if (trigger.trigger_status !== 'enabled') {
    return c.json(ok({ fired: false, reason: 'trigger_disabled', trigger_id }));
  }
  if (trigger.trigger_type === 'schedule' && uses_rivet_event_job_dispatch()) {
    return c.json(ok({ fired: false, reason: 'schedule_fired_by_clock', trigger_id }));
  }

  const occurrence_key = (await read_occurrence_key(c)) ?? current_minute_bucket();
  const fired = await fire_trigger(c.get('db'), trigger, { occurrence_key });
  if (!fired) {
    return c.json(ok({ fired: false, reason: 'no_job_handler', trigger_id }));
  }

  return c.json(
    ok({
      fired: fired.fired,
      trigger_id,
      event_id: fired.event_id,
      queued_job_count: fired.queued_job_count,
    }),
    202,
  );
}

event_routes.post('/v1/events/:trigger_id', fire_trigger_by_id);
event_routes.post('/v1/triggers/:trigger_id/fire', fire_trigger_by_id);

async function read_occurrence_key(c: Context<ApiEnv>): Promise<string | undefined> {
  const text = await c.req.text();
  if (!text) return undefined;
  return parse_json_text(text, fire_body_schema)?.occurrence_key;
}

function current_minute_bucket(): string {
  return new Date().toISOString().slice(0, 16);
}
