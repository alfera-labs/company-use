import { list_automations } from '@coworker/core/db/queries/automation_reads';
import { list_automation_triggers } from '@coworker/core/db/queries/automation_triggers';
import {
  automation_list_output_schema,
  list_automations_input_schema,
} from '@runtime-platform/tools/definitions/automations_schemas';
import {
  automations_app_name,
  input_json_schema,
  output_json_schema,
  read_automation_context,
  summarize_automation,
} from '@runtime-platform/tools/definitions/automations_support';
import type { RuntimeToolDefinition } from '@runtime-platform/tools/types';

export const list_automations_tool: RuntimeToolDefinition<typeof list_automations_input_schema> = {
  node_key: 'automations-list_automations-1',
  node_name: 'list_automations',
  display_name: 'List automations',
  description:
    'Lists the standing work this agent holds, with every way each automation can start. Call it before creating an automation that may already exist.',
  category: 'scheduling',
  input_schema: input_json_schema(list_automations_input_schema),
  output_schema: output_json_schema(automation_list_output_schema),
  app_name: automations_app_name,
  required_connection: false,
  runtime_handler: 'automations.list_automations',
  approval_policy: { mode: 'none' },
  metadata: { safe_for_first_milestone: true },
  validate_input: list_automations_input_schema,
  async execute(input, context) {
    const parsed_context = read_automation_context(context, 'automations-list_automations-1');
    if (!parsed_context.success) return parsed_context;
    const ctx = parsed_context.data;

    const rows = await list_automations(ctx.db, {
      workspace_id: ctx.workspace_id,
      agent_id: ctx.agent_id,
      ...(input.include_paused ? {} : { automation_statuses: ['enabled'] }),
      limit: 25,
    });
    // One triggers query per automation, bounded by that limit of 25. Batch it when a
    // workspace really keeps hundreds of automations.
    const automations = await Promise.all(
      rows.map(async (automation) =>
        summarize_automation(
          automation,
          await list_automation_triggers(ctx.db, {
            workspace_id: ctx.workspace_id,
            automation_id: automation.automation_id,
          }),
        ),
      ),
    );

    return {
      success: true,
      data: automation_list_output_schema.parse({ count: automations.length, automations }),
    };
  },
};
