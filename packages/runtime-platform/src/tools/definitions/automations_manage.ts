import { get_automation } from '@coworker/core/db/queries/automation_reads';
import { AppError } from '@coworker/shared';
import { read_automation_lifecycle } from '@runtime-platform/automations/automation_lifecycle';
import { automation_result } from '@runtime-platform/tools/definitions/automations_readback';
import {
  automation_id_input_schema,
  automation_output_schema,
  delete_automation_output_schema,
  edit_automation_input_schema,
  run_now_output_schema,
  set_automation_status_input_schema,
} from '@runtime-platform/tools/definitions/automations_schemas';
import {
  edited_conditions_and_judge,
  edited_triggers_and_policy,
} from '@runtime-platform/tools/definitions/automations_service_input';
import {
  ask_the_person_error,
  automations_app_name,
  input_json_schema,
  is_a_person_turn,
  output_json_schema,
  read_automation_context,
  refuse_touching_somebody_elses_automation,
  tool_error,
} from '@runtime-platform/tools/definitions/automations_support';
import type { RuntimeToolDefinition } from '@runtime-platform/tools/types';

export const edit_automation_tool: RuntimeToolDefinition<typeof edit_automation_input_schema> = {
  node_key: 'automations-edit_automation-1',
  node_name: 'edit_automation',
  display_name: 'Edit automation',
  description:
    'Edits an automation in place, keeping its id and the sessions it already opened. Editing the instruction changes what every future run is told. Pass triggers to replace every way it starts (the same shapes as create_automation); pass judge_question: null to remove the judge.',
  category: 'scheduling',
  input_schema: input_json_schema(edit_automation_input_schema),
  output_schema: output_json_schema(automation_output_schema),
  app_name: automations_app_name,
  required_connection: false,
  runtime_handler: 'automations.edit_automation',
  approval_policy: { mode: 'none' },
  source_context_policy: { mode: 'current_turn' },
  metadata: { safe_for_first_milestone: false },
  validate_input: edit_automation_input_schema,
  async execute(input, context) {
    const parsed_context = read_automation_context(context, 'automations-edit_automation-1');
    if (!parsed_context.success) return parsed_context;
    const ctx = parsed_context.data;
    if (!is_a_person_turn(ctx)) return ask_the_person_error('change its own settings');

    try {
      const current = await get_automation(ctx.db, {
        workspace_id: ctx.workspace_id,
        automation_id: input.automation_id,
      });
      if (!current)
        return tool_error('not_found', `Automation ${input.automation_id} was not found.`);
      const updated = await read_automation_lifecycle().update_automation(ctx.db, {
        workspace_id: ctx.workspace_id,
        automation_id: input.automation_id,
        actor_id: ctx.actor_id,
        ...(input.name === undefined ? {} : { automation_name: input.name }),
        ...(input.instruction === undefined ? {} : { instruction: input.instruction }),
        ...edited_conditions_and_judge(current, input),
        ...(await edited_triggers_and_policy(ctx, current.run_policy, input)),
      });

      return await automation_result(ctx.db, updated.automation, updated.triggers);
    } catch (error) {
      if (error instanceof AppError) return tool_error(error.code, error.message);
      throw error;
    }
  },
};

export const set_automation_status_tool: RuntimeToolDefinition<
  typeof set_automation_status_input_schema
> = {
  node_key: 'automations-set_automation_status-1',
  node_name: 'set_automation_status',
  display_name: 'Set automation status',
  description:
    'Turns an automation on or off. Pausing takes down every trigger it listens on and keeps the automation and its history saved.',
  category: 'scheduling',
  input_schema: input_json_schema(set_automation_status_input_schema),
  output_schema: output_json_schema(automation_output_schema),
  app_name: automations_app_name,
  required_connection: false,
  runtime_handler: 'automations.set_automation_status',
  approval_policy: { mode: 'none' },
  metadata: { safe_for_first_milestone: false },
  validate_input: set_automation_status_input_schema,
  async execute(input, context) {
    const parsed_context = read_automation_context(context, 'automations-set_automation_status-1');
    if (!parsed_context.success) return parsed_context;
    const ctx = parsed_context.data;

    try {
      const refused = await refuse_touching_somebody_elses_automation(
        ctx,
        input.automation_id,
        'pause or resume',
      );
      if (refused) return refused;
      const updated = await read_automation_lifecycle().set_automation_status(ctx.db, {
        workspace_id: ctx.workspace_id,
        automation_id: input.automation_id,
        automation_status: input.status,
        actor_id: ctx.actor_id,
      });

      return await automation_result(ctx.db, updated.automation, updated.triggers);
    } catch (error) {
      if (error instanceof AppError) return tool_error(error.code, error.message);
      throw error;
    }
  },
};

export const delete_automation_tool: RuntimeToolDefinition<typeof automation_id_input_schema> = {
  node_key: 'automations-delete_automation-1',
  node_name: 'delete_automation',
  display_name: 'Delete automation',
  description:
    'Deletes an automation and every watch it holds at the providers. The runs it already did stay readable.',
  category: 'scheduling',
  input_schema: input_json_schema(automation_id_input_schema),
  output_schema: output_json_schema(delete_automation_output_schema),
  app_name: automations_app_name,
  required_connection: false,
  runtime_handler: 'automations.delete_automation',
  approval_policy: { mode: 'none' },
  metadata: { safe_for_first_milestone: false },
  validate_input: automation_id_input_schema,
  async execute(input, context) {
    const parsed_context = read_automation_context(context, 'automations-delete_automation-1');
    if (!parsed_context.success) return parsed_context;
    const ctx = parsed_context.data;

    try {
      await read_automation_lifecycle().delete_automation(ctx.db, {
        workspace_id: ctx.workspace_id,
        automation_id: input.automation_id,
        actor_id: ctx.actor_id,
      });

      return {
        success: true,
        data: delete_automation_output_schema.parse({
          automation_id: input.automation_id,
          deleted: true,
        }),
      };
    } catch (error) {
      if (error instanceof AppError) return tool_error(error.code, error.message);
      throw error;
    }
  },
};

export const run_automation_now_tool: RuntimeToolDefinition<typeof automation_id_input_schema> = {
  node_key: 'automations-run_now-1',
  node_name: 'run_now',
  display_name: 'Run automation now',
  description:
    'Starts one run of an automation immediately, the same way its own triggers would. Use it to show the user what the automation does before they wait for its schedule.',
  category: 'scheduling',
  input_schema: input_json_schema(automation_id_input_schema),
  output_schema: output_json_schema(run_now_output_schema),
  app_name: automations_app_name,
  required_connection: false,
  runtime_handler: 'automations.run_now',
  approval_policy: { mode: 'none' },
  metadata: { safe_for_first_milestone: false },
  validate_input: automation_id_input_schema,
  async execute(input, context) {
    const parsed_context = read_automation_context(context, 'automations-run_now-1');
    if (!parsed_context.success) return parsed_context;
    const ctx = parsed_context.data;

    try {
      const refused = await refuse_touching_somebody_elses_automation(
        ctx,
        input.automation_id,
        'run',
      );
      if (refused) return refused;
      const fired = await read_automation_lifecycle().run_automation_now(ctx.db, {
        workspace_id: ctx.workspace_id,
        automation_id: input.automation_id,
        occurrence_key: `${ctx.run_id}:${Date.now()}`,
        actor_id: ctx.actor_id,
      });

      return {
        success: true,
        data: run_now_output_schema.parse({
          automation_id: input.automation_id,
          started: fired.fired,
          event_id: fired.event_id,
        }),
      };
    } catch (error) {
      if (error instanceof AppError) return tool_error(error.code, error.message);
      throw error;
    }
  },
};
