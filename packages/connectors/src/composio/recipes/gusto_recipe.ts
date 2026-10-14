import type { ComposioRecipe } from '@connectors/composio/composio_recipe_types';

export const gusto_recipe: ComposioRecipe = {
  toolkit_slug: 'GUSTO',
  prompt: 'Sync Gusto employees',
  dimensions: [
    {
      key: 'company',
      label: 'Company',
      shape: 'flat',
      list_scope_options: { node_key: 'gusto-get_token_info-1' },
      option_items: [{ $: 'response.resource' }],
      option_mapping: { id: { $: 'item.uuid' }, label: 'Gusto company', kind: 'company' },
      allow_select_all: true,
      prompt: 'Sync the employees of the Gusto company this connection belongs to.',
    },
  ],
  objects: {
    employee: {
      label: 'Employee',
      list_items: { node_key: 'gusto-list_employees-1' },
      scoped_by: { company: 'company_id' },
      page: {
        items: { $: 'response.employees' },
        cursor_kind: 'page_number',
        cursor_param: 'page',
        first_cursor: 1,
        page_size: 100,
        page_size_param: 'per',
      },
      strategy: 'relist_diff',
      identity: { $: 'item.uuid' },
      version_signal: { $: 'item.version' },
      tombstone: { value_of: { $: 'item.terminated' }, is_one_of: [true] },
      title: {
        $default: [
          {
            $join: {
              parts: [
                { $default: [{ $: 'item.preferred_first_name' }, { $: 'item.first_name' }] },
                { $: 'item.last_name' },
              ],
              separator: ' ',
            },
          },
          { $: 'item.work_email' },
          { $: 'item.email' },
        ],
      },
      content: {
        first_name: { $default: [{ $: 'item.preferred_first_name' }, { $: 'item.first_name' }] },
        last_name: { $: 'item.last_name' },
        job_title: { $: 'item.title' },
        department: { $: 'item.department' },
        work_email: { $: 'item.work_email' },
        hired_at: { $: 'item.hired_at' },
        employment_status: { $: 'item.current_employment_status' },
        manager_uuid: { $: 'item.manager_uuid' },
      },
      item_kind: 'person_profile',
      metadata: {
        email: { $default: [{ $: 'item.work_email' }, { $: 'item.email' }] },
        department: { $: 'item.department' },
        onboarding_status: { $: 'item.onboarding_status' },
      },
      note: 'GUSTO_LIST_EMPLOYEES needs company_id. GUSTO_GET_TOKEN_INFO names the company the token belongs to (resource.uuid), so that is the one scope option. Content leaves out SSN, birth date, and home address. The title joins the preferred (or legal) first name and the last name, then falls back to the work email. A terminated employee is tombstoned.',
    },
  },
};
