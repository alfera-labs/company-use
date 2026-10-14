import { z } from 'zod';
import type {
  AutomationTrigger,
  TriggerTypeCatalog,
} from '@/components/app/automations/automations_api';
import {
  describe_trigger_input,
  trigger_row_to_input,
} from '@/components/app/automations/trigger_types_model';

const problem_config_schema = z
  .object({ provisioning_error: z.string().trim().min(1).optional().catch(undefined) })
  .nullable()
  .catch(null);

export function read_trigger_problem(trigger: AutomationTrigger | undefined): string | null {
  if (trigger?.trigger_status !== 'error') return null;
  return problem_config_schema.parse(trigger.trigger_config)?.provisioning_error ?? null;
}

export function describe_first_trigger_problem(
  triggers: AutomationTrigger[],
  catalog: TriggerTypeCatalog | undefined,
): string | null {
  const broken = triggers.find((trigger) => trigger.trigger_status === 'error');
  if (!broken) return null;
  const title = describe_trigger_input(trigger_row_to_input(broken), catalog).line;
  const reason = read_trigger_problem(broken);
  return reason ? `${title} is not running: ${reason}` : `${title} is not running.`;
}
