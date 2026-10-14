import { list_active_runs_for_reader } from '@runtime-platform/tools/active_run_reads';
import {
  input_json_schema,
  output_json_schema,
  read_automation_context,
  what_an_active_run_belongs_to,
} from '@runtime-platform/tools/definitions/automations_support';
import {
  list_active_runs_input_schema,
  list_active_runs_output_schema,
} from '@runtime-platform/tools/definitions/sessions_schemas';
import type { RuntimeToolDefinition } from '@runtime-platform/tools/types';

export const list_active_runs_tool: RuntimeToolDefinition<typeof list_active_runs_input_schema> = {
  node_key: 'sessions-list_active_runs-1',
  node_name: 'list_active_runs',
  display_name: 'List active runs',
  description: [
    `Lists the runs going right now in the conversations you may read, with ${what_an_active_run_belongs_to} each one belongs to.`,
    'Call it before starting work on a thread: another run may already be on it, and two agents on one subject is worse than waiting.',
  ].join(' '),
  category: 'context',
  input_schema: input_json_schema(list_active_runs_input_schema),
  output_schema: output_json_schema(list_active_runs_output_schema),
  app_name: 'sessions',
  required_connection: false,
  runtime_handler: 'sessions.list_active_runs',
  approval_policy: { mode: 'none' },
  metadata: { safe_for_first_milestone: true },
  validate_input: list_active_runs_input_schema,
  async execute(input, context) {
    const parsed_context = read_automation_context(context, 'sessions-list_active_runs-1');
    if (!parsed_context.success) return parsed_context;
    const ctx = parsed_context.data;

    const runs = await list_active_runs_for_reader(ctx.db, {
      workspace_id: ctx.workspace_id,
      reader_user_id: ctx.actor_id,
      limit: input.limit,
    });

    return {
      success: true,
      data: list_active_runs_output_schema.parse({ count: runs.length, runs }),
    };
  },
};
