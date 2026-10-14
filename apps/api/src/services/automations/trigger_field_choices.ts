import type { Database } from '@coworker/core';
import { get_tool_catalog_entry } from '@coworker/core/db/queries/catalog';
import { get_app_action_node_key } from '@coworker/core/db/queries/catalog_app_action';
import { connections } from '@coworker/core/db/schema';
import type { TriggerFieldChoiceSource } from '@coworker/core/db/schema/json_column_types';
import { format_error_message } from '@coworker/shared';
import { read_choice_list } from '@runtime-platform/catalog/field_choices/read_choice_list';
import { read_trigger_provider_app_id } from '@runtime-platform/tools/definitions/trigger_node_fields';
import { execute_catalog_tool_for_person } from '@runtime-platform/tools/execute_catalog_tool_for_person';
import { find_field_choice_source } from '@runtime-platform/tools/trigger_field_hints';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

type ChoiceSource = TriggerFieldChoiceSource;
export type TriggerChoiceResult =
  | { status: 'ok'; choices: { value: string; label: string }[] }
  | { status: 'missing'; message: string }
  | { status: 'access_denied'; message: string }
  | { status: 'provider_error'; message: string };

const action_result_schema = z.object({ output: z.unknown() });
type ChoiceRequest = {
  workspace_id: string;
  actor_id: string;
  node_key: string;
  field: string;
  connection_id: string;
};

export async function list_trigger_field_choices(
  db: Database,
  input: ChoiceRequest,
): Promise<TriggerChoiceResult> {
  const entry = await get_tool_catalog_entry(db, {
    node_key: input.node_key,
    workspace_id: input.workspace_id,
  });
  const trigger = entry?.node_kind === 'trigger' ? entry : null;
  const provider_app_id = read_trigger_provider_app_id(trigger?.node_config);
  const source = find_field_choice_source(input.field, provider_app_id, trigger?.node_config);
  const properties = z
    .object({ properties: z.record(z.string(), z.unknown()) })
    .safeParse(trigger?.input_schema);
  if (!trigger || !source || !properties.success || !(input.field in properties.data.properties)) {
    return { status: 'missing', message: 'This trigger field has no provider choices.' };
  }
  const connection = await db.query.connections.findFirst({
    where: and(
      eq(connections.connection_id, input.connection_id),
      eq(connections.workspace_id, input.workspace_id),
      eq(connections.app_id, trigger.app_id),
      eq(connections.connection_status, 'active'),
    ),
  });
  if (!connection) return { status: 'missing', message: 'This app connection was not found.' };
  const action_node_key = await get_app_action_node_key(db, {
    workspace_id: input.workspace_id,
    app_id: trigger.app_id,
    node_name: source.action_node_name,
  });
  if (!action_node_key) {
    return { status: 'missing', message: 'The provider choices action was not found.' };
  }
  return run_choice_action(db, input, action_node_key, source);
}

async function run_choice_action(
  db: Database,
  input: ChoiceRequest,
  action_node_key: string,
  source: ChoiceSource,
): Promise<TriggerChoiceResult> {
  try {
    const result = await execute_catalog_tool_for_person(db, {
      workspace_id: input.workspace_id,
      user_id: input.actor_id,
      node_key: action_node_key,
      connection_id: input.connection_id,
      tool_input: {},
    });
    if (!result.success) {
      const status = result.error.code === 'access_denied' ? 'access_denied' : 'provider_error';
      return { status, message: result.error.message };
    }
    const envelope = action_result_schema.safeParse(result.data);
    if (!envelope.success) {
      return {
        status: 'provider_error',
        message: 'The provider answered in a shape nobody expected.',
      };
    }
    return { status: 'ok', choices: read_choice_list(envelope.data.output, source) };
  } catch (error) {
    return {
      status: 'provider_error',
      message: format_error_message(error, 'The provider could not list choices.'),
    };
  }
}
