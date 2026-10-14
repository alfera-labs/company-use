import type { ApiEnv } from '@api/lib/context';
import { ok } from '@api/lib/response';
import { validate_json } from '@api/lib/validate';
import { send_welcome_email } from '@api/services/notifications';
import { open_onboarding_first_session_once } from '@api/services/onboarding_first_session_once';
import { run_company_scan } from '@api/services/onboarding_scan';
import { send_slack_welcome } from '@api/services/onboarding_slack_welcome';
import { read_onboarding_snapshot } from '@api/services/onboarding_snapshot';
import { capture_product_event } from '@api/services/product_events';
import { create_workspace_scout_trigger } from '@api/services/scout/scout_provisioning';
import { env } from '@coworker/config';
import { type Database, grant_workspace_dev_skip_plan } from '@coworker/core';
import {
  complete_onboarding,
  save_onboarding_profile,
  set_onboarding_step,
} from '@coworker/core/db/queries/onboarding';
import { get_user } from '@coworker/core/db/queries/users';
import { create_logger, format_person_name, NotFoundError } from '@coworker/shared';
import { Hono } from 'hono';
import { z } from 'zod';

const notifications_log = create_logger('notifications');
const onboarding_log = create_logger('onboarding');

const onboarding_profile_schema = z.object({
  how_found_us: z.string().max(160).optional(),
  role: z.string().max(160).optional(),
  work_kind: z.string().max(160).optional(),
  marketing_opt_in: z.boolean().optional(),
});

const onboarding_step_schema = z.object({
  step: z.string().min(1).max(40),
});

const company_scan_schema = z
  .object({
    website_url: z.string().trim().min(1).max(500).optional(),
    company_description: z.string().trim().min(1).max(2000).optional(),
  })
  .strict()
  .refine((body) => Boolean(body.website_url || body.company_description), {
    message: 'Give either a website or a description of the company.',
  });

const complete_onboarding_schema = z
  .object({ picked_job_name: z.string().max(60).optional() })
  .strict();

export const onboarding_routes = new Hono<ApiEnv>()
  .get('/v1/onboarding', async (c) => {
    const db = c.get('db');
    const workspace_id = c.get('workspace_id');
    const user_id = c.get('user_id');

    return c.json(ok(await read_onboarding_snapshot(db, { workspace_id, user_id })));
  })
  .post('/v1/onboarding/profile', validate_json(onboarding_profile_schema), async (c) => {
    const body = c.req.valid('json');
    const profile = await save_onboarding_profile(c.get('db'), {
      user_id: c.get('user_id'),
      actor_id: c.get('user_id'),
      profile: body,
    });
    return c.json(ok({ profile }));
  })
  .post('/v1/onboarding/company-scan', validate_json(company_scan_schema), async (c) => {
    const body = c.req.valid('json');
    const result = await run_company_scan(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      actor_id: c.get('user_id'),
      ...(body.website_url === undefined ? {} : { website_url: body.website_url }),
      ...(body.company_description === undefined
        ? {}
        : { company_description: body.company_description }),
    });
    return c.json(ok(result));
  })
  .post('/v1/onboarding/step', validate_json(onboarding_step_schema), async (c) => {
    const body = c.req.valid('json');
    const record = await set_onboarding_step(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      actor_id: c.get('user_id'),
      step: body.step,
    });
    return c.json(ok(record));
  })
  .post('/v1/onboarding/complete', validate_json(complete_onboarding_schema), async (c) => {
    const record = await complete_onboarding(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      actor_id: c.get('user_id'),
    });
    const first_session_id = await open_onboarding_first_session_once(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      agent_id: c.get('agent_id'),
      user_id: c.get('user_id'),
      company_scan: record.company_scan,
      picked_job_name: c.req.valid('json').picked_job_name,
      first_completion: record.first_completion,
    });
    await create_workspace_scout_trigger(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      actor_id: c.get('user_id'),
    });
    await Promise.all([
      send_welcome_email(c.get('db'), c.get('workspace_id')).catch((error: unknown) =>
        notifications_log.error('welcome email failed', error),
      ),
      record.first_completion
        ? report_onboarding_completed(c.get('db'), {
            workspace_id: c.get('workspace_id'),
            user_id: c.get('user_id'),
          }).catch((error: unknown) =>
            onboarding_log.error('reporting onboarding completion failed', error),
          )
        : Promise.resolve(),
    ]);
    return c.json(ok({ ...record, first_session_id }));
  })
  .post('/v1/onboarding/dev-skip', async (c) => {
    if (env.ENVIRONMENT !== 'development') throw new NotFoundError('Route');
    const db = c.get('db');
    const workspace_id = c.get('workspace_id');
    const user_id = c.get('user_id');

    await complete_onboarding(db, { workspace_id, actor_id: user_id });
    const plan = await grant_workspace_dev_skip_plan(db, { workspace_id, actor_id: user_id });

    return c.json(
      ok({
        completed: true,
        plan_slug: plan.plan_slug,
        balance_microcents: plan.balance_microcents,
      }),
    );
  })
  .post('/v1/onboarding/welcome', async (c) => {
    const result = await send_slack_welcome(c.get('db'), {
      workspace_id: c.get('workspace_id'),
      user_id: c.get('user_id'),
    });
    return c.json(ok(result));
  });

async function report_onboarding_completed(
  db: Database,
  input: { workspace_id: string; user_id: string },
) {
  const user = await get_user(db, input.user_id);
  if (!user) return;
  if (!user.external_identity_id) {
    onboarding_log.info('no WorkOS id to report the onboarding finish on', {
      workspace_id: input.workspace_id,
      user_id: input.user_id,
    });
    return;
  }
  const full_name = format_person_name(user.first_name, user.last_name);
  await capture_product_event({
    person: {
      distinct_id: user.external_identity_id,
      email: user.email,
      name: full_name || null,
    },
    event: 'onboarding_completed',
    properties: { workspace_id: input.workspace_id },
  });
}
