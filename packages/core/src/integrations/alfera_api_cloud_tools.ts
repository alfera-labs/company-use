import type { ToolGroupData } from '@coworker/core/db/schema/json_column_types';
import {
  destructive,
  in_group,
  read,
  write,
} from '@coworker/core/integrations/alfera_api_tool_entry';

export const cloud_tool_groups = [
  {
    group_key: 'automations',
    title: 'Automations',
    description: 'Saved jobs that run on a schedule or when something happens.',
    position: 1,
  },
] as const satisfies ReadonlyArray<ToolGroupData>;

export const cloud_tools = [
  ...in_group('automations', [
    read('list_automations', 'List automations', 'List the standing jobs.'),
    read('get_automation', 'Get an automation', 'Read one automation.'),
    write('create_automation', 'Create an automation', 'Create a standing job.'),
    write('update_automation', 'Update an automation', 'Change an automation.'),
    write('trigger_automation', 'Trigger an automation', 'Start an automation now.'),
    destructive('delete_automation', 'Delete an automation', 'Delete an automation.'),
  ]),
];
