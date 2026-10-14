import { query_salesforce_records } from '@connectors/apps/salesforce/query_records/v1/execute';
import fixtures from '@connectors/apps/salesforce/query_records/v1/fixtures.json' with {
  type: 'json',
};
import definition from '@connectors/apps/salesforce/query_records/v1/node.json' with {
  type: 'json',
};
import {
  build_connection_without_instance_url,
  build_salesforce_test_context,
  list_required_output_keys,
  salesforce_app_definition,
  salesforce_test_instance_url,
} from '@connectors/apps/salesforce/salesforce_test_context';
import { describe, expect, it } from 'vitest';

describe('salesforce app.json', () => {
  it('declares the OAuth app the connector needs', () => {
    expect(salesforce_app_definition.auth).toEqual({
      kind: 'oauth2',
      auth_url: 'https://login.salesforce.com/services/oauth2/authorize',
      token_url: 'https://login.salesforce.com/services/oauth2/token',
      scopes: ['api', 'refresh_token'],
    });
    expect(salesforce_app_definition.base_url).toBe('https://login.salesforce.com');
    expect(salesforce_app_definition.quirks.connection_must_carry_instance_url).toContain(
      'instance_url',
    );
  });
});

describe('salesforce-query_records-1 node.json', () => {
  it('is a plural node keyed by its own path', () => {
    expect(definition.node_key).toBe('salesforce-query_records-1');
    expect(definition.implementation).toBe('execute');
    expect(definition.required_scopes).toEqual(['api']);
    expect(Object.keys(definition.input_schema.properties)).toEqual(['soql', 'cursor']);
    expect(definition.input_schema.required).toEqual(['soql']);
    expect(definition.output_schema.properties.records.type).toBe('array');
    expect(definition.output_schema.properties.next_cursor.type).toEqual(['string', 'null']);
  });

  it('declares a lenient provider ingress that still catches a wrong answer', async () => {
    expect(definition.requests.query_page.response_schema.required).toEqual(['done']);
    const { context } = build_salesforce_test_context(() => ({ done: 'yes' }));

    await expect(
      query_salesforce_records({ soql: 'SELECT Id FROM Account' }, context),
    ).rejects.toThrow(/does not match response_schema/u);
  });
});

describe('salesforce-query_records-1 execute', () => {
  it('sends the SOQL to the connection org and pages on the returned locator', async () => {
    const { context, requests } = build_salesforce_test_context(
      () => fixtures.query_records_first_page,
    );

    const output = await query_salesforce_records(
      { soql: 'SELECT Id, Name FROM Account' },
      context,
    );

    expect(requests).toEqual([
      {
        base_url: salesforce_test_instance_url,
        method: 'GET',
        path: '/services/data/v61.0/query',
        query: { q: 'SELECT Id, Name FROM Account' },
        body: undefined,
      },
    ]);
    expect(output).toEqual({
      records: fixtures.query_records_first_page.records,
      next_cursor: '01gRO0000016PIYYA2-2000',
      done: false,
      total_size: 3,
    });
    expect(Object.keys(output).sort()).toEqual(list_required_output_keys(definition.output_schema));
  });

  it('reads the next page from the locator path, not from the query string', async () => {
    const { context, requests } = build_salesforce_test_context(
      () => fixtures.query_records_last_page,
    );

    const output = await query_salesforce_records(
      { soql: 'SELECT Id, Name FROM Account', cursor: '01gRO0000016PIYYA2-2000' },
      context,
    );

    expect(requests[0]).toMatchObject({
      path: '/services/data/v61.0/query/01gRO0000016PIYYA2-2000',
      query: undefined,
    });
    expect(output).toMatchObject({ next_cursor: null, done: true, total_size: 3 });
  });

  it('reports an empty result as done with no records', async () => {
    const { context } = build_salesforce_test_context(() => fixtures.query_records_empty);

    const output = await query_salesforce_records({ soql: 'SELECT Id FROM Lead' }, context);

    expect(output).toEqual({ records: [], next_cursor: null, done: true, total_size: 0 });
  });

  it('refuses a cursor that is not a page locator', async () => {
    const { context, requests } = build_salesforce_test_context(
      () => fixtures.query_records_last_page,
    );

    await expect(
      query_salesforce_records(
        { soql: 'SELECT Id FROM Account', cursor: '../../sobjects/Account/001D000000IRFmaIAH' },
        context,
      ),
    ).rejects.toThrow(/not a page locator/u);
    expect(requests).toEqual([]);
  });

  it('names the missing instance_url instead of calling the login host', async () => {
    const { context, requests } = build_salesforce_test_context(
      () => fixtures.query_records_last_page,
      build_connection_without_instance_url(),
    );

    await expect(
      query_salesforce_records({ soql: 'SELECT Id FROM Account' }, context),
    ).rejects.toThrow(/has no instance_url/u);
    expect(requests).toEqual([]);
  });
});
