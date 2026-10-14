import type { ApiEnv } from '@api/lib/context';
import { automation_trigger_choice_routes } from '@api/routes/automation_trigger_choices';
import { automation_routes } from '@api/routes/automations';
import { trigger_routes } from '@api/routes/triggers';
import { only_its_owner_changes_an_automation_trigger } from '@api/services/automations/automation_trigger_owner_rule';
import { Hono } from 'hono';

export const automation_route_group = new Hono<ApiEnv>()
  .use('/v1/triggers/:trigger_id', only_its_owner_changes_an_automation_trigger)
  .use('/v1/triggers/:trigger_id/*', only_its_owner_changes_an_automation_trigger)
  .route('/', trigger_routes)
  .route('/', automation_routes)
  .route('/', automation_trigger_choice_routes);
