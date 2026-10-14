import type { ComposioRecipe } from '@connectors/composio/composio_recipe_types';

export const composio_attio_recipe: ComposioRecipe = {
  toolkit_slug: 'ATTIO',
  prompt: 'Pick the Attio objects to keep in sync.',
  dimensions: [
    {
      key: 'objects',
      label: 'Objects',
      shape: 'flat',
      list_scope_options: { node_key: 'attio_v2-list_objects-1' },
      option_mapping: {
        id: { $default: [{ $: 'item.api_slug' }, { $: 'item.id.object_id' }] },
        label: {
          $default: [
            { $: 'item.singular_noun' },
            { $: 'item.plural_noun' },
            { $: 'item.api_slug' },
            { $: 'item.id.object_id' },
          ],
        },
      },
      allow_select_all: true,
      prompt: 'Pick the Attio objects to sync records from.',
    },
  ],
  objects: {
    record: {
      list_items: {
        node_key: 'attio_v2-query_records-1',
        input: { sorts: [{ attribute: 'created_at', direction: 'asc' }] },
      },
      scoped_by: { objects: 'object' },
      page: {
        items: { $: 'response.data' },
        cursor_kind: 'offset',
        cursor_param: 'offset',
        page_size: 500,
        page_size_param: 'limit',
      },
      strategy: 'relist_diff',
      identity: { $: 'item.id.record_id' },
      title: {
        $default: [
          { $: 'item.values.name.0.full_name' },
          { $: 'item.values.name.0.value' },
          { $: 'item.id.record_id' },
        ],
      },
      content: { $: 'item.values' },
      item_kind: 'attio_record',
      container: { id: { $: 'scope.id' }, path: { $: 'scope.label' } },
      source_url: { $: 'item.web_url' },
      metadata: {
        object: { $: 'scope.label' },
        created_time: { $: 'item.created_at' },
      },
      label: 'Records',
      note: 'One scope per Attio object, standard or custom, read from ATTIO_LIST_OBJECTS; select-all lists them again at every sync, so a new custom object joins on its own. A custom object can come back without api_slug or singular_noun, so the scope id falls back to the object id, which ATTIO_QUERY_RECORDS also accepts. Record values are a map of attribute slugs that differs per object, so the content is the whole values map. ATTIO_QUERY_RECORDS returns no cursor: it pages by offset, 500 at most, sorted by created_at so the offsets stay stable while the walk runs. A person name carries full_name, every other name carries value.',
    },
  },
};
