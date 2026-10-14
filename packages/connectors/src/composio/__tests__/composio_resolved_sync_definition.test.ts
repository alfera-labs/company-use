import type {
  ComposioRecipe,
  ComposioRecipeObject,
} from '@connectors/composio/composio_recipe_types';
import { resolve_composio_sync_definition } from '@connectors/composio/composio_resolved_sync_definition';
import { describe, expect, it } from 'vitest';

const record_object: ComposioRecipeObject = {
  list_items: { node_key: 'demo-list_records-1', input: { page_size: 50 } },
  scoped_by: { objects: 'object_type' },
  page: { items: { $: 'response.records' } },
  strategy: 'relist_diff',
  identity: { $: 'item.id' },
  title: { $: 'item.name' },
  content: { $: 'item.body' },
  item_kind: 'record',
};

const recipe: ComposioRecipe = {
  toolkit_slug: 'DEMO',
  dimensions: [
    {
      key: 'objects',
      label: 'Objects',
      shape: 'flat',
      list_scope_options: { node_key: 'demo-list_object_types-1', input: { limit: 20 } },
      list_children: { node_key: 'demo-list_children-1', parent_id_param: 'parent_id' },
      allow_select_all: true,
    },
  ],
  objects: { record: record_object },
};

describe('resolve_composio_sync_definition', () => {
  it('maps the node roles to the native door vocabulary', () => {
    const resolved = resolve_composio_sync_definition(recipe);

    expect(resolved.dimensions).toEqual([
      {
        key: 'objects',
        label: 'Objects',
        shape: 'flat',
        browse_node: 'demo-list_object_types-1',
        browse_input: { limit: 20 },
        allow_select_all: true,
      },
    ]);
    expect(resolved.objects.record).toMatchObject({
      list_node: 'demo-list_records-1',
      list_input: { page_size: 50 },
      scoped_by: { objects: 'object_type' },
      item_kind: 'record',
    });
    expect(resolved.objects.record).not.toHaveProperty('list_items');
  });

  it('turns a read_item node into the read_node content the door runs per record', () => {
    const { content: _content, ...listed } = record_object;
    const resolved = resolve_composio_sync_definition({
      ...recipe,
      objects: {
        record: {
          ...listed,
          read_item: {
            node_key: 'demo-get_record-1',
            input: { record_id: { $: 'item.id' } },
            text: { $: 'response.body' },
          },
        },
      },
    });
    expect(resolved.objects.record?.content).toEqual({
      read_node: 'demo-get_record-1',
      input: { record_id: { $: 'item.id' } },
      text: { $: 'response.body' },
    });
  });

  it('drops no dimensions or objects from the recipe', () => {
    const resolved = resolve_composio_sync_definition(recipe);
    expect(Object.keys(resolved.objects)).toEqual(['record']);
    expect(resolved.dimensions).toHaveLength(1);
  });

  it('keeps read_items_batch as the read_batch the sync runtime runs', () => {
    const { content: _content, ...listed } = record_object;
    const resolved = resolve_composio_sync_definition({
      ...recipe,
      objects: {
        record: {
          ...listed,
          read_items_batch: {
            node_key: 'demo-get_records-1',
            ids_param: 'ids',
            items: { $: 'response.records' },
            identity: { $: 'item.id' },
            text: { $: 'item.body' },
            max_batch_size: 25,
          },
        },
      },
    });
    expect(resolved.objects.record?.read_batch).toEqual({
      read_node: 'demo-get_records-1',
      ids_param: 'ids',
      items: { $: 'response.records' },
      identity: { $: 'item.id' },
      text: { $: 'item.body' },
      max_batch_size: 25,
    });
    expect(resolved.objects.record?.content).toBeNull();
  });
});
