import { type BrainTool, define_brain_tool } from '@api/routes/brain/brain_tool';
import {
  reads_the_workspace,
  saves_a_job_that_runs_the_agent_later,
  starts_agent_work_that_cannot_be_unsent,
} from '@api/routes/brain/mcp_tool_annotations';
import { create_automation_body_schema } from '@api/routes/public_automations';
import {
  create_api_automation,
  get_api_automation,
  list_api_automations,
  trigger_api_automation,
} from '@api/services/automations_api/public_automations';
import type { automation_summary_schema } from '@runtime-platform/tools/definitions/automations_schemas';
import { z } from 'zod';

const automation_id_schema = z.string().min(1).max(200);

type AutomationSummary = z.infer<typeof automation_summary_schema>;

function format_automation_for_mcp(automation: AutomationSummary) {
  return {
    automation_id: automation.automation_id,
    name: automation.name,
    status: automation.status,
    instruction: automation.instruction,
    subject_from: automation.subject_from,
    sends_without_asking: automation.sends_without_asking,
    triggers: automation.triggers.map((trigger) => ({
      kind: trigger.kind,
      status: trigger.status,
      cron: trigger.cron,
      node_key: trigger.node_key,
      webhook_url: trigger.webhook_url ?? null,
      webhook_url_note: trigger.webhook_url_note ?? null,
      problem: trigger.problem,
    })),
  };
}

export const automation_mcp_tools: Record<string, BrainTool> = {
  list_automations: define_brain_tool({
    title: 'List automations',
    annotations: reads_the_workspace,
    description:
      'List the work Alfera does for this company without being asked: each standing job, what it does, and what starts it (a schedule, a new email or app event, a webhook, or a manual run). Answers at once: use it instead of a session whenever the person asks what is automated.',
    required_scope: 'automations.read',
    input_schema: z.strictObject({}),
    run: async (db, api_key) =>
      (await list_api_automations(db, api_key)).map(format_automation_for_mcp),
  }),

  get_automation: define_brain_tool({
    title: 'Get an automation',
    annotations: reads_the_workspace,
    description: 'Read one automation by id: its instruction, status, and triggers.',
    required_scope: 'automations.read',
    input_schema: z.strictObject({ automation_id: automation_id_schema }),
    run: async (db, api_key, args) =>
      format_automation_for_mcp(await get_api_automation(db, api_key, args.automation_id)),
  }),

  create_automation: define_brain_tool({
    title: 'Create an automation',
    annotations: saves_a_job_that_runs_the_agent_later,
    description:
      'Set up work the coworker repeats on its own: a name, the instruction it follows each time, and at least one trigger: {kind:"schedule", cron}, {kind:"app_event", node_key}, {kind:"webhook"}, or {kind:"manual"}. Read the instruction and the trigger back to the person and get a yes before you create it, because every run acts in their connected apps.',
    required_scope: 'automations.write',
    input_schema: create_automation_body_schema,
    run: async (db, api_key, args) =>
      format_automation_for_mcp(await create_api_automation(db, api_key, args)),
  }),

  trigger_automation: define_brain_tool({
    title: 'Trigger an automation',
    annotations: starts_agent_work_that_cannot_be_unsent,
    description:
      'Run one standing job now. Find its automation_id with list_automations first, and confirm with the person which one they mean. Pass the same idempotency_key again and a retry lands on the first run instead of starting a second. It returns once the run has started; the result appears where that job normally reports.',
    required_scope: 'automations.write',
    input_schema: z.strictObject({
      automation_id: automation_id_schema,
      idempotency_key: z.string().min(1).max(120).optional(),
    }),
    run: async (db, api_key, args) => {
      const fired = await trigger_api_automation(db, api_key, {
        automation_id: args.automation_id,
        idempotency_key: args.idempotency_key,
      });
      return { automation_id: fired.automation_id, started: fired.started };
    },
  }),
};
