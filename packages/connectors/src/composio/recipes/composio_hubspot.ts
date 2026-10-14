import type { ComposioRecipe } from '@connectors/composio/composio_recipe_types';

export const composio_hubspot_recipe: ComposioRecipe = {
  toolkit_slug: 'HUBSPOT',
  prompt: 'Pick the HubSpot object type to keep in sync.',
  dimensions: [
    {
      key: 'custom_object_types',
      label: 'Object types',
      shape: 'flat',
      list_scope_options: { node_key: 'hubspot_v2-retrieve_all_object_schemas-1' },
      option_mapping: {
        id: { $: 'item.objectTypeId' },
        label: { $: 'item.name' },
      },
      allow_select_all: true,
      prompt: 'Pick the HubSpot object types to sync records from.',
    },
    {
      key: 'object_type',
      label: 'Object type name',
      shape: 'query',
      search_param: 'objectType',
      placeholder: 'contacts',
      prompt: 'A HubSpot object type name, for a type not listed above.',
    },
  ],
  objects: {
    record: {
      list_items: {
        node_key: 'hubspot_v2-read_apage_of_objects_by_type-1',
        input: {
          limit: 100,
          properties: [
            'name',
            'dealname',
            'subject',
            'firstname',
            'lastname',
            'email',
            'domain',
            'description',
            'content',
            'hubspot_owner_id',
          ],
        },
      },
      scoped_by: { custom_object_types: 'objectType', object_type: 'objectType' },
      page: {
        items: { $: 'response.results' },
        next_cursor: { $: 'response.paging.next.after' },
        cursor_param: 'after',
      },
      strategy: 'relist_diff',
      identity: { $: 'item.id' },
      version_signal: { $: 'item.updatedAt' },
      title: {
        $default: [
          { $: 'item.properties.name' },
          { $: 'item.properties.dealname' },
          { $: 'item.properties.subject' },
          { $: 'item.properties.email' },
          { $: 'item.id' },
        ],
      },
      content: {
        $default: [
          { $: 'item.properties.description' },
          { $: 'item.properties.content' },
          { $literal: '' },
        ],
      },
      item_kind: 'hubspot_record',
      source_url: { $: 'item.url' },
      container: { id: { $: 'scope.id' }, path: { $: 'scope.label' } },
      relationships: { owned_by: { $: 'item.properties.hubspot_owner_id' } },
      metadata: {
        object_type: { $: 'scope.label' },
        created_time: { $: 'item.createdAt' },
        updated_time: { $: 'item.updatedAt' },
      },
      label: 'Records',
      note: 'HubSpot properties are a map per object type, so the property paths stay unverifiable by schema. The list asks for the title and body properties of companies, contacts, deals, and tickets; HubSpot leaves out a property an object type lacks.',
    },
  },
};
