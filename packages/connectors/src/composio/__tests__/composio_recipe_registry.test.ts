import { check_composio_recipe } from '@connectors/composio/check_composio_recipe';
import {
  get_composio_recipe,
  list_composio_recipes,
} from '@connectors/composio/composio_recipe_registry';
import type { ComposioRecipe } from '@connectors/composio/composio_recipe_types';
import { describe, expect, it } from 'vitest';

const registered_toolkit_slugs = [
  'ASANA',
  'ATTIO',
  'CANVA',
  'CONFLUENCE',
  'DATABRICKS',
  'DATADOG',
  'DOCUSIGN',
  'GITHUB',
  'GMAIL',
  'GOOGLECALENDAR',
  'GOOGLEDRIVE',
  'GUSTO',
  'HUBSPOT',
  'JIRA',
  'LINEAR',
  'MAILCHIMP',
  'MICROSOFT_TEAMS',
  'NETSUITE',
  'NOTION',
  'ONE_DRIVE',
  'OUTLOOK',
  'QUICKBOOKS',
  'SALESFORCE',
  'SENTRY',
  'STRIPE',
  'XERO',
  'ZOHO',
];

describe('composio recipe registry', () => {
  it('finds a recipe by toolkit slug and keeps the native-only slack out', () => {
    expect(get_composio_recipe('GMAIL')?.toolkit_slug).toBe('GMAIL');
    expect(get_composio_recipe('SLACK')).toBeUndefined();
    expect(
      list_composio_recipes()
        .map((recipe) => recipe.toolkit_slug)
        .sort(),
    ).toEqual(registered_toolkit_slugs);
  });

  it('holds docusign with a reason instead of a sync it cannot run', () => {
    const docusign = get_composio_recipe('DOCUSIGN');
    expect(docusign?.unavailable_reason).toMatch(/lists envelopes/);
    expect(docusign?.objects).toEqual({});
  });

  it('answers undefined for a toolkit with no recipe', () => {
    expect(get_composio_recipe('COWORKER_DEMO_UNREGISTERED')).toBeUndefined();
  });
});

const valid_recipe_object = {
  list_items: { node_key: 'demo-list_records-1' },
  scoped_by: { objects: 'object_type' },
  page: { items: { $: 'response.records' } },
  strategy: 'relist_diff' as const,
  identity: { $: 'item.id' },
  title: { $: 'item.name' },
  content: { $: 'item.body' },
  item_kind: 'record',
};

const valid_recipe: ComposioRecipe = {
  toolkit_slug: 'DEMO',
  dimensions: [{ key: 'objects', label: 'Objects', shape: 'flat' }],
  objects: { record: valid_recipe_object },
};

describe('check_composio_recipe', () => {
  it('passes a well-formed recipe', () => {
    expect(() => check_composio_recipe(valid_recipe)).not.toThrow();
  });

  it('rejects a recipe scoped by an undeclared dimension', () => {
    const broken: ComposioRecipe = {
      toolkit_slug: valid_recipe.toolkit_slug,
      dimensions: valid_recipe.dimensions,
      objects: {
        record: { ...valid_recipe_object, scoped_by: { missing_dimension: 'object_type' } },
      },
    };
    expect(() => check_composio_recipe(broken)).toThrow(/not a declared dimension/);
  });

  it('accepts a relation the memory relation registry knows, such as attendee', () => {
    const with_relation: ComposioRecipe = {
      toolkit_slug: valid_recipe.toolkit_slug,
      dimensions: valid_recipe.dimensions,
      objects: {
        record: { ...valid_recipe_object, relationships: { attendee: { $: 'item.organizer_id' } } },
      },
    };
    expect(() => check_composio_recipe(with_relation)).not.toThrow();
  });

  it('rejects a relation name the registry does not know', () => {
    const with_relation: ComposioRecipe = {
      toolkit_slug: valid_recipe.toolkit_slug,
      dimensions: valid_recipe.dimensions,
      objects: {
        record: { ...valid_recipe_object, relationships: { made_up_relation: { $: 'item.id' } } },
      },
    };
    expect(() => check_composio_recipe(with_relation)).toThrow();
  });

  it('accepts a read_item node in place of inline content', () => {
    const { content: _content, ...listed } = valid_recipe_object;
    const with_read_item: ComposioRecipe = {
      toolkit_slug: valid_recipe.toolkit_slug,
      dimensions: valid_recipe.dimensions,
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
    };
    expect(() => check_composio_recipe(with_read_item)).not.toThrow();
  });

  it('rejects an object with neither content nor read_item', () => {
    const { content: _content, ...listed } = valid_recipe_object;
    const broken: ComposioRecipe = {
      toolkit_slug: valid_recipe.toolkit_slug,
      dimensions: valid_recipe.dimensions,
      objects: { record: listed },
    };
    expect(() => check_composio_recipe(broken)).toThrow(/malformed/);
  });

  it('rejects a raw composio slug where a catalog node key belongs', () => {
    const with_raw_list_slug: ComposioRecipe = {
      ...valid_recipe,
      objects: {
        record: { ...valid_recipe_object, list_items: { node_key: 'DEMO_LIST_RECORDS' } },
      },
    };
    const with_raw_browse_slug: ComposioRecipe = {
      ...valid_recipe,
      dimensions: [
        {
          key: 'objects',
          label: 'Objects',
          shape: 'flat',
          list_scope_options: { node_key: 'DEMO_LIST_OBJECT_TYPES' },
        },
      ],
    };
    expect(() => check_composio_recipe(with_raw_list_slug)).toThrow(/node_key/);
    expect(() => check_composio_recipe(with_raw_browse_slug)).toThrow(/node_key/);
  });

  it('rejects a recipe with no objects unless it is marked unavailable', () => {
    expect(() => check_composio_recipe({ ...valid_recipe, objects: {} })).toThrow(/malformed/);
    expect(() =>
      check_composio_recipe({ ...valid_recipe, objects: {}, unavailable_reason: 'No list node.' }),
    ).not.toThrow();
  });

  it('accepts a null scope only for an implicit_single_account dimension', () => {
    const implicit_dimension = {
      key: 'objects',
      label: 'Objects',
      shape: 'flat' as const,
      implicit_single_account: true as const,
    };
    const record = { ...valid_recipe_object, scoped_by: { objects: null } };
    expect(() =>
      check_composio_recipe({
        ...valid_recipe,
        dimensions: [implicit_dimension],
        objects: { record },
      }),
    ).not.toThrow();
    expect(() => check_composio_recipe({ ...valid_recipe, objects: { record } })).toThrow(
      /only an implicit_single_account dimension allows/,
    );
  });

  it('rejects browse calls on an implicit_single_account dimension', () => {
    const dimension = {
      key: 'objects',
      label: 'Objects',
      shape: 'flat' as const,
      implicit_single_account: true as const,
      list_scope_options: { node_key: 'demo-list_object_types-1' },
    };
    expect(() => check_composio_recipe({ ...valid_recipe, dimensions: [dimension] })).toThrow(
      /has no browse calls/,
    );
  });

  it('checks the counted cursor rules', () => {
    const with_page = (page: Record<string, unknown>) => ({
      ...valid_recipe,
      objects: {
        record: { ...valid_recipe_object, page: { items: { $: 'response.records' }, ...page } },
      },
    });
    expect(() =>
      check_composio_recipe(with_page({ cursor_param: 'page', cursor_kind: 'page_number' })),
    ).not.toThrow();
    expect(() => check_composio_recipe(with_page({ cursor_kind: 'page_number' }))).toThrow(
      /needs page.cursor_param/,
    );
    expect(() =>
      check_composio_recipe(with_page({ cursor_param: 'offset', cursor_kind: 'offset' })),
    ).toThrow(/needs page.page_size/);
    expect(() =>
      check_composio_recipe(
        with_page({
          cursor_param: 'page',
          cursor_kind: 'page_number',
          next_cursor: { $: 'response.next' },
        }),
      ),
    ).toThrow(/counts instead of reading next_cursor/);
    expect(() =>
      check_composio_recipe(
        with_page({ cursor_param: 'token', next_cursor: { $: 'response.next' }, first_cursor: 1 }),
      ),
    ).toThrow(/only a counted cursor reads/);
  });

  it('checks the last_item cursor rules', () => {
    const with_page = (page: Record<string, unknown>) => ({
      ...valid_recipe,
      objects: {
        record: { ...valid_recipe_object, page: { items: { $: 'response.records' }, ...page } },
      },
    });
    const last_item = {
      cursor_kind: 'last_item',
      cursor_param: 'starting_after',
      next_cursor: { $: 'item.id' },
      has_more: { $: 'response.has_more' },
    };
    expect(() => check_composio_recipe(with_page(last_item))).not.toThrow();
    const { next_cursor: _next, ...without_next } = last_item;
    expect(() => check_composio_recipe(with_page(without_next))).toThrow(
      /last_item cursor, which needs page.cursor_param and page.next_cursor/,
    );
    expect(() =>
      check_composio_recipe(
        with_page({ cursor_param: 'token', next_cursor: { $: 'response.next' }, has_more: true }),
      ),
    ).toThrow(/only a counted or last_item cursor reads/);
  });

  it('accepts a hyphenated watermark input and a string watermark template', () => {
    const cursor = {
      field: { $: 'item.updated' },
      param: 'If-Modified-Since',
      template: { text: "updated > '{watermark}'", escape: 'sql_quote' as const },
    };
    const record = { ...valid_recipe_object, strategy: 'modified_since' as const, cursor };
    expect(() => check_composio_recipe({ ...valid_recipe, objects: { record } })).not.toThrow();
    const no_placeholder = { ...cursor, template: { ...cursor.template, text: 'updated > 0' } };
    expect(() =>
      check_composio_recipe({
        ...valid_recipe,
        objects: { record: { ...record, cursor: no_placeholder } },
      }),
    ).toThrow(/malformed/);
    const integer_template = {
      ...cursor,
      param_type: 'integer' as const,
      marker_format: 'epoch_seconds' as const,
    };
    expect(() =>
      check_composio_recipe({
        ...valid_recipe,
        objects: { record: { ...record, cursor: integer_template } },
      }),
    ).toThrow(/fills a watermark template, which sends a string/);
  });

  it('needs epoch_seconds for an integer watermark', () => {
    const cursor = { field: { $: 'item.updated' }, param: 'since', param_type: 'integer' as const };
    const record = { ...valid_recipe_object, strategy: 'modified_since' as const, cursor };
    expect(() => check_composio_recipe({ ...valid_recipe, objects: { record } })).toThrow(
      /needs marker_format epoch_seconds/,
    );
    const epoch_record = {
      ...record,
      cursor: { ...cursor, marker_format: 'epoch_seconds' as const },
    };
    expect(() =>
      check_composio_recipe({ ...valid_recipe, objects: { record: epoch_record } }),
    ).not.toThrow();
  });

  it('accepts read_items_batch as the only content source', () => {
    const { content: _content, ...listed } = valid_recipe_object;
    const record = {
      ...listed,
      read_items_batch: {
        node_key: 'demo-get_records-1',
        ids_param: 'ids',
        items: { $: 'response.records' },
        identity: { $: 'item.id' },
        text: { $: 'item.body' },
        max_batch_size: 50,
      },
    };
    expect(() => check_composio_recipe({ ...valid_recipe, objects: { record } })).not.toThrow();
  });
});
