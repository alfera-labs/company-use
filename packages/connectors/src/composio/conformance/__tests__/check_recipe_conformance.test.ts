import type { ComposioRecipe } from '@connectors/composio/composio_recipe_types';
import { check_recipe_conformance } from '@connectors/composio/conformance/check_recipe_conformance';
import type { ConformanceNode } from '@connectors/composio/conformance/conformance_types';
import { describe, expect, it } from 'vitest';

const ticket_list_output = {
  type: 'object',
  properties: { data: { $ref: '#/$defs/TicketPage' }, successful: { type: 'boolean' } },
  $defs: {
    Ticket: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        subject: { type: 'string' },
        updated_at: { type: 'string' },
        comments: { type: 'array', items: { $ref: '#/$defs/Comment' } },
      },
    },
    Comment: { type: 'object', properties: { body: { type: 'string' } } },
    TicketPage: {
      type: 'object',
      properties: {
        tickets: { type: 'array', items: { $ref: '#/$defs/Ticket' } },
        next_page_token: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      },
    },
  },
};

const queue_list_output = {
  type: 'object',
  properties: {
    data: {
      type: 'object',
      properties: {
        queues: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: { type: 'string' }, name: { type: 'string' } },
          },
        },
      },
    },
  },
};

function build_node(node_key: string, overrides: Partial<ConformanceNode>): ConformanceNode {
  return {
    node_key,
    node_status: 'active',
    successor_node_key: null,
    input_schema: { type: 'object', properties: {} },
    output_schema: { type: 'object', properties: { data: { type: 'object' } } },
    output_source: 'catalog',
    ...overrides,
  };
}

const fixture_nodes = new Map<string, ConformanceNode>([
  ['desk-list_queues-1', build_node('desk-list_queues-1', { output_schema: queue_list_output })],
  [
    'desk-list_tickets-1',
    build_node('desk-list_tickets-1', {
      input_schema: {
        type: 'object',
        required: ['queue_id'],
        properties: {
          queue_id: { type: 'string' },
          page_token: { type: 'string' },
          sort: { type: 'string', enum: ['asc', 'desc'] },
          page: { type: 'integer' },
        },
      },
      output_schema: ticket_list_output,
    }),
  ],
]);

function build_recipe(overrides: Partial<ComposioRecipe['objects'][string]> = {}): ComposioRecipe {
  return {
    toolkit_slug: 'DESK',
    dimensions: [
      {
        key: 'queues',
        label: 'Queues',
        shape: 'flat',
        list_scope_options: { node_key: 'desk-list_queues-1' },
        option_mapping: { id: { $: 'item.id' }, label: { $: 'item.name' } },
      },
    ],
    objects: {
      ticket: {
        list_items: { node_key: 'desk-list_tickets-1', input: { sort: 'desc' } },
        scoped_by: { queues: 'queue_id' },
        page: {
          items: { $: 'response.tickets' },
          next_cursor: { $: 'response.next_page_token' },
          cursor_param: 'page_token',
        },
        strategy: 'relist_diff',
        identity: { $: 'item.id' },
        title: { $: 'item.subject' },
        content: { $map: { from: { $: 'item.comments' }, to: { $: 'item.body' } } },
        version_signal: { $: 'item.updated_at' },
        item_kind: 'ticket',
        ...overrides,
      },
    },
  };
}

function check(recipe: ComposioRecipe, nodes = fixture_nodes) {
  return check_recipe_conformance(recipe, (node_key) => nodes.get(node_key));
}

function fields_of(recipe: ComposioRecipe, nodes = fixture_nodes) {
  return check(recipe, nodes).problems.map((problem) => `${problem.level} ${problem.field}`);
}

describe('check_recipe_conformance', () => {
  it('passes a recipe whose inputs and output paths match the node schemas', () => {
    const result = check(build_recipe());
    expect(result.problems).toEqual([]);
    expect(result.verdict).toBe('PASS');
  });

  it('reports an output path the schema does not have, with the keys it does have', () => {
    const result = check(
      build_recipe({
        page: {
          items: { $: 'response.tickets' },
          next_cursor: { $: 'response.nextPageToken' },
          cursor_param: 'page_token',
        },
      }),
    );
    expect(result.verdict).toBe('FAIL');
    expect(result.problems).toEqual([
      expect.objectContaining({
        role: 'list_items',
        field: 'page.next_cursor: response.nextPageToken',
        actual: 'missing (has tickets, next_page_token)',
        level: 'error',
      }),
    ]);
  });

  it('reports a wrong items path once, without a cascade on every item field', () => {
    const recipe = build_recipe({
      page: {
        items: { $: 'response.data.tickets' },
        next_cursor: { $: 'response.next_page_token' },
        cursor_param: 'page_token',
      },
    });
    expect(fields_of(recipe)).toEqual(['error page.items: response.data.tickets']);
  });

  it('resolves a $map body against the array element', () => {
    const recipe = build_recipe({
      content: { $map: { from: { $: 'item.comments' }, to: { $: 'item.text' } } },
    });
    expect(fields_of(recipe)).toEqual(['error content: item.text']);
  });

  it('reports a missing required input, an undeclared input, a wrong type, and a wrong enum value', () => {
    const recipe = build_recipe({
      list_items: { node_key: 'desk-list_tickets-1', input: { sort: 'newest', team: 'a' } },
      scoped_by: { queues: 'queue' },
      page: {
        items: { $: 'response.tickets' },
        next_cursor: { $: 'response.next_page_token' },
        cursor_param: 'page',
      },
    });
    expect(fields_of(recipe)).toEqual([
      'error queue_id',
      'error sort',
      'error team',
      'error queue',
      'error page',
    ]);
    const page_problem = check(recipe).problems.find((problem) => problem.field === 'page');
    expect(page_problem).toMatchObject({ expected: 'type integer', actual: 'type string' });
  });

  it('reports a cursor param that has no next cursor to feed it', () => {
    const recipe = build_recipe({
      page: { items: { $: 'response.tickets' }, cursor_param: 'page_token' },
    });
    expect(fields_of(recipe)).toEqual(['error page.next_cursor']);
  });

  it('reports a deprecated node with its recorded successor', () => {
    const nodes = new Map(fixture_nodes);
    const deprecated = build_node('desk-list_queues-1', {
      node_status: 'deprecated',
      successor_node_key: 'desk-find_queues-1',
      output_schema: queue_list_output,
    });
    nodes.set('desk-list_queues-1', deprecated);
    const result = check(build_recipe(), nodes);
    expect(result.problems).toEqual([
      expect.objectContaining({
        field: 'node_status',
        actual: 'deprecated, successor desk-find_queues-1',
      }),
    ]);
  });

  it('fails a flat dimension without list_scope_options and only warns for a query dimension', () => {
    const recipe = build_recipe();
    recipe.dimensions = [
      { key: 'queues', label: 'Queues', shape: 'flat' },
      { key: 'search', label: 'Search', shape: 'query' },
    ];
    const ticket = build_recipe({ scoped_by: { queues: 'queue_id', search: 'queue_id' } }).objects
      .ticket;
    if (ticket) recipe.objects.ticket = ticket;
    expect(fields_of(recipe)).toEqual(['error list_scope_options', 'warning list_scope_options']);
  });

  it('accepts a browse node whose answer is a bare array', () => {
    const nodes = new Map(fixture_nodes);
    const bare_array = {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: { type: 'string' }, name: { type: 'string' } },
          },
        },
      },
    };
    nodes.set(
      'desk-list_queues-1',
      build_node('desk-list_queues-1', { output_schema: bare_array }),
    );
    expect(fields_of(build_recipe(), nodes)).toEqual([]);
  });

  it('checks the option_mapping against the declared option_items path', () => {
    const recipe = build_recipe();
    const [queues] = recipe.dimensions;
    if (queues) {
      recipe.dimensions = [
        { ...queues, option_items: { $: 'response.queues' } },
        { ...queues, key: 'other', option_items: { $: 'response.teams' } },
      ];
    }
    expect(fields_of(recipe)).toEqual(['error option_items: response.teams']);
  });

  it('warns, without failing, when the output schema is open', () => {
    const nodes = new Map(fixture_nodes);
    nodes.set('desk-list_queues-1', build_node('desk-list_queues-1', {}));
    const result = check(build_recipe(), nodes);
    expect(result.verdict).toBe('PASS');
    expect(result.problems.map((problem) => problem.level)).toEqual(['warning', 'warning']);
  });

  it('fails an object with neither content nor read_item', () => {
    const recipe = build_recipe();
    if (recipe.objects.ticket) delete recipe.objects.ticket.content;
    expect(fields_of(recipe)).toEqual(['error read_item, read_items_batch, or content']);
  });

  it('accepts an integer page_number cursor where the node declares an integer page', () => {
    const counted = build_recipe({
      page: { items: { $: 'response.tickets' }, cursor_param: 'page', cursor_kind: 'page_number' },
    });
    expect(fields_of(counted)).toEqual([]);
  });

  it('reports a counted cursor sent into a string input', () => {
    const counted = build_recipe({
      page: {
        items: { $: 'response.tickets' },
        cursor_param: 'page_token',
        cursor_kind: 'offset',
        page_size: 50,
      },
    });
    const problem = check(counted).problems.find((one) => one.field === 'page_token');
    expect(problem).toMatchObject({ expected: 'type string', actual: 'type integer' });
  });

  it('passes an implicit_single_account dimension that sends no scope input', () => {
    const recipe = build_recipe({
      list_items: { node_key: 'desk-list_tickets-1', input: { queue_id: 'all' } },
      scoped_by: { account: null },
    });
    recipe.dimensions = [
      { key: 'account', label: 'Account', shape: 'flat', implicit_single_account: true },
    ];
    expect(fields_of(recipe)).toEqual([]);
  });

  it('warns when an implicit_single_account scope is written into an input', () => {
    const recipe = build_recipe({ scoped_by: { account: 'queue_id' } });
    recipe.dimensions = [
      { key: 'account', label: 'Account', shape: 'flat', implicit_single_account: true },
    ];
    expect(fields_of(recipe)).toEqual(['warning scoped_by.account: queue_id']);
  });

  it('checks read_items_batch against the node, including its maxItems', () => {
    const nodes = new Map(fixture_nodes);
    nodes.set(
      'desk-get_tickets-1',
      build_node('desk-get_tickets-1', {
        input_schema: {
          type: 'object',
          required: ['ids'],
          properties: { ids: { type: 'array', maxItems: 20, items: { type: 'string' } } },
        },
        output_schema: ticket_list_output,
      }),
    );
    const batch = {
      node_key: 'desk-get_tickets-1',
      ids_param: 'ids',
      items: { $: 'response.tickets' },
      identity: { $: 'item.id' },
      text: { $: 'item.subject' },
    };
    const fitting = build_recipe({ read_items_batch: { ...batch, max_batch_size: 20 } });
    expect(fields_of(fitting, nodes)).toEqual([]);
    const unbounded = build_recipe({ read_items_batch: batch });
    expect(fields_of(unbounded, nodes)).toEqual(['error max_batch_size']);
  });
  it('reads a last_item next_cursor against the last item, not the response', () => {
    const page = {
      items: { $: 'response.tickets' },
      cursor_kind: 'last_item' as const,
      cursor_param: 'page_token',
    };
    expect(fields_of(build_recipe({ page: { ...page, next_cursor: { $: 'item.id' } } }))).toEqual(
      [],
    );
    expect(fields_of(build_recipe({ page: { ...page, next_cursor: { $: 'item.uuid' } } }))).toEqual(
      ['error page.next_cursor: item.uuid'],
    );
  });

  it('checks every $join part against the item', () => {
    const title = { $join: { parts: [{ $: 'item.subject' }, { $: 'item.headline' }] } };
    expect(fields_of(build_recipe({ title }))).toEqual(['error title: item.headline']);
  });

  it('checks option_when against the browse item', () => {
    const recipe = build_recipe();
    const [dimension] = recipe.dimensions;
    if (!dimension) throw new Error('the recipe has no dimension');
    const with_when = (option_when: unknown) => ({
      ...recipe,
      dimensions: [{ ...dimension, option_when }],
    });
    expect(fields_of(with_when({ $: 'item.name' }))).toEqual([]);
    expect(fields_of(with_when({ $: 'item.folder' }))).toEqual(['error option_when: item.folder']);
  });

  it('warns on a listing_limit_note, so a capped listing is never silent', () => {
    const result = check(build_recipe({ listing_limit_note: 'The node reads the first page.' }));
    expect(result.verdict).toBe('PASS');
    expect(result.problems).toEqual([
      expect.objectContaining({
        field: 'listing_limit_note',
        actual: 'The node reads the first page.',
        level: 'warning',
      }),
    ]);
  });

  it('accepts a watermark template sent into a string input', () => {
    const cursor = {
      field: { $: 'item.updated_at' },
      param: 'sort',
      template: { text: "updated > '{watermark}'", escape: 'sql_quote' as const },
    };
    const problems = fields_of(build_recipe({ strategy: 'modified_since', cursor }));
    expect(problems).toEqual([]);
    const integer_cursor = { ...cursor, param: 'page' };
    expect(fields_of(build_recipe({ strategy: 'modified_since', cursor: integer_cursor }))).toEqual(
      ['error page'],
    );
  });
});
