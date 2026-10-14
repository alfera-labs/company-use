import type { ComposioRecipe } from '@connectors/composio/composio_recipe_types';

export const composio_asana_recipe: ComposioRecipe = {
  toolkit_slug: 'ASANA',
  prompt: 'Pick the Asana project to keep in sync.',
  dimensions: [
    {
      key: 'projects',
      label: 'Projects',
      shape: 'flat',
      list_scope_options: { node_key: 'asana-get_multiple_projects-1', input: { limit: 100 } },
      option_mapping: {
        id: { $: 'item.gid' },
        label: { $: 'item.name' },
      },
      allow_select_all: true,
      prompt: 'Pick the Asana projects to sync tasks from.',
    },
  ],
  objects: {
    task: {
      list_items: { node_key: 'asana-get_tasks_from_a_project-1', input: { limit: 100 } },
      scoped_by: { projects: 'project_gid' },
      page: {
        items: { $: 'response.data' },
        next_cursor: { $: 'response.next_page.offset' },
        cursor_param: 'offset',
      },
      strategy: 'relist_diff',
      read_item: {
        node_key: 'asana-get_a_task-1',
        input: { task_gid: { $: 'item.gid' } },
        text: {
          notes: { $default: [{ $: 'response.data.data.notes' }, { $literal: '' }] },
          completed: { $: 'response.data.data.completed' },
          due_on: { $: 'response.data.data.due_on' },
          assignee: { $: 'response.data.data.assignee.name' },
        },
      },
      identity: { $: 'item.gid' },
      title: { $default: [{ $: 'item.name' }, { $: 'item.gid' }] },
      item_kind: 'asana_task',
      container: { id: { $: 'scope.id' }, path: { $: 'scope.label' } },
      relationships: { author: { $: 'item.created_by.gid' } },
      metadata: {
        subtype: { $: 'item.resource_subtype' },
        project: { $: 'scope.label' },
      },
      label: 'Tasks',
      note: 'ASANA_GET_TASKS_FROM_A_PROJECT returns compact tasks (gid, name, created_by), so ASANA_GET_A_TASK reads the notes, completion, due date, and assignee per task.',
    },
  },
};
