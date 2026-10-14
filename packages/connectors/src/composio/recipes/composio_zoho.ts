import type { ComposioRecipe } from '@connectors/composio/composio_recipe_types';

export const composio_zoho_recipe: ComposioRecipe = {
  toolkit_slug: 'ZOHO',
  prompt: 'Pick the Zoho CRM module to keep in sync.',
  dimensions: [
    {
      key: 'modules',
      label: 'Modules',
      shape: 'flat',
      list_scope_options: { node_key: 'zoho-list_modules-1' },
      option_mapping: {
        id: { $: 'item.api_name' },
        label: { $: 'item.plural_label' },
      },
      allow_select_all: true,
      prompt: 'Pick the Zoho CRM modules to sync records from.',
    },
  ],
  objects: {
    record: {
      list_items: {
        node_key: 'zoho-get_zoho_records-1',
        input: {
          per_page: 200,
          fields:
            'Name,Full_Name,Account_Name,Deal_Name,Subject,Email,Description,Modified_Time,Owner',
        },
      },
      scoped_by: { modules: 'module_api_name' },
      page: {
        items: { $: 'response.data' },
        next_cursor: { $: 'response.info.next_page_token' },
        cursor_param: 'page_token',
      },
      strategy: 'relist_diff',
      identity: { $: 'item.id' },
      version_signal: { $: 'item.Modified_Time' },
      title: {
        $default: [
          { $: 'item.Name' },
          { $: 'item.Full_Name' },
          { $: 'item.Deal_Name' },
          { $: 'item.Subject' },
          { $: 'item.Account_Name' },
          { $: 'item.id' },
        ],
      },
      content: { $default: [{ $: 'item.Description' }, { $literal: '' }] },
      item_kind: 'zoho_record',
      container: { id: { $: 'scope.id' }, path: { $: 'scope.label' } },
      relationships: { owned_by: { $: 'item.Owner.id' } },
      metadata: {
        module: { $: 'scope.label' },
        modified_time: { $: 'item.Modified_Time' },
      },
      label: 'Records',
      note: 'Zoho field names differ per module, so the field paths stay unverifiable by schema. ZOHO_GET_ZOHO_RECORDS returns only the fields it is asked for, so the list names the title, body, and time fields of the common modules.',
    },
  },
};
