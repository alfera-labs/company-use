import {
  check_node_definition,
  check_output_against_schema,
  load_hubspot_node,
  type NodeQuirks,
  run_http_mapping,
  stub_hubspot_fetch,
} from '@connectors/apps/hubspot/__tests__/hubspot_test_support';
import fixtures from '@connectors/apps/hubspot/search_records/v1/fixtures.json' with {
  type: 'json',
};
import definition from '@connectors/apps/hubspot/search_records/v1/node.json' with { type: 'json' };
import { reset_rate_limit_buckets } from '@connectors/runtime/rate_limiter';
import type { ConnectorHttpMapping } from '@connectors/types';
import { fill_path_template } from '@connectors/value_expression';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const node = load_hubspot_node('search_records', definition);
const extras = node as unknown as NodeQuirks;
const mapping = node.http as ConnectorHttpMapping;

beforeEach(() => {
  reset_rate_limit_buckets();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('hubspot-search_records-1 node.json', () => {
  it('needs no code: the whole call is a declarative http mapping', () => {
    check_node_definition(node, 'hubspot-search_records-1');
    expect(node.implementation).toBe('http');
    expect(mapping.method).toBe('POST');
    expect(mapping.path).toBe('/crm/v3/objects/{input.object_type}/search');
    expect(mapping.to_output).toBeDefined();
    expect(mapping.paginate).toBeUndefined();
    expect(extras.endpoints).toEqual([
      {
        purpose: 'search',
        method: 'POST',
        path: '/crm/v3/objects/{object_type}/search',
        max_page_size: 200,
      },
    ]);
    expect(node.required_scopes).toEqual([
      'crm.objects.contacts.read',
      'crm.objects.companies.read',
      'crm.objects.deals.read',
    ]);
    expect(extras.quirks.join(' ')).toContain('request BODY');
  });

  it('pins object_type so a path segment cannot be smuggled into the url', () => {
    const input_schema = node.input_schema as { properties: Record<string, { pattern: string }> };
    const pattern = new RegExp(input_schema.properties.object_type?.pattern ?? '', 'u');

    expect(pattern.test('contacts')).toBe(true);
    expect(pattern.test('2-1234567')).toBe(true);
    expect(pattern.test('../../oauth/v1/access-tokens')).toBe(false);
    expect(fill_path_template(mapping.path, { input: { object_type: 'a/b' } })).toBe(
      '/crm/v3/objects/a%2Fb/search',
    );
  });
});

describe('hubspot-search_records-1', () => {
  it('sends filter groups, the cursor and the page size in the search body', async () => {
    const calls = stub_hubspot_fetch(() => ({ body: fixtures.search_contacts_page_one }));

    await run_http_mapping(mapping, {
      object_type: 'contacts',
      filter_groups: [
        {
          filters: [
            { property: 'lifecyclestage', operator: 'EQ', value: 'customer' },
            { property: 'createdate', operator: 'BETWEEN', low_value: '1', high_value: '2' },
          ],
        },
        { filters: [{ property: 'email', operator: 'HAS_PROPERTY' }] },
      ],
      query: 'rossi',
      properties: ['email', 'firstname'],
      cursor: '51200',
      limit: 2,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.path).toBe('/crm/v3/objects/contacts/search');
    expect(calls[0]?.body).toEqual({
      filterGroups: [
        {
          filters: [
            { propertyName: 'lifecyclestage', operator: 'EQ', value: 'customer' },
            { propertyName: 'createdate', operator: 'BETWEEN', value: '1', highValue: '2' },
          ],
        },
        { filters: [{ propertyName: 'email', operator: 'HAS_PROPERTY' }] },
      ],
      query: 'rossi',
      properties: ['email', 'firstname'],
      after: '51200',
      limit: 2,
    });
  });

  it('sends an empty filterGroups when the caller gives no filters', async () => {
    const calls = stub_hubspot_fetch(() => ({ body: fixtures.search_no_matches }));

    await run_http_mapping(mapping, { object_type: 'deals', query: 'renewal' });

    expect(calls[0]?.body).toEqual({ filterGroups: [], query: 'renewal' });
  });

  it('maps a recorded page onto records, next_cursor and total', async () => {
    stub_hubspot_fetch(() => ({ body: fixtures.search_contacts_page_one }));

    const output = await run_http_mapping(mapping, { object_type: 'contacts', query: 'rossi' });

    check_output_against_schema(output, node.output_schema);
    expect(output).toEqual({
      records: [
        {
          id: '51201',
          properties: fixtures.search_contacts_page_one.results[0]?.properties,
          created_at: '2026-03-02T14:10:22.023Z',
          updated_at: '2026-08-11T09:41:03.881Z',
          archived: false,
        },
        {
          id: '51202',
          properties: fixtures.search_contacts_page_one.results[1]?.properties,
          created_at: '2026-04-19T08:02:44.117Z',
          updated_at: '2026-08-30T16:22:10.004Z',
          archived: false,
        },
      ],
      next_cursor: '51202',
      total: 3,
    });
  });

  it('reports the last page as a null cursor', async () => {
    stub_hubspot_fetch(() => ({ body: fixtures.search_contacts_last_page }));

    const output = await run_http_mapping(mapping, { object_type: 'contacts', cursor: '51202' });

    expect(output).toMatchObject({ next_cursor: null, total: 3 });
  });

  it('returns an empty page rather than an error when nothing matches', async () => {
    stub_hubspot_fetch(() => ({ body: fixtures.search_no_matches }));

    const output = await run_http_mapping(mapping, { object_type: 'deals', query: 'nothing' });

    check_output_against_schema(output, node.output_schema);
    expect(output).toEqual({ records: [], next_cursor: null, total: 0 });
  });
});
