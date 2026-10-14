import { create_salesforce_records } from '@connectors/apps/salesforce/create_records/v1/execute';
import fixtures from '@connectors/apps/salesforce/create_records/v1/fixtures.json' with {
  type: 'json',
};
import definition from '@connectors/apps/salesforce/create_records/v1/node.json' with {
  type: 'json',
};
import {
  build_salesforce_test_context,
  list_required_output_keys,
  type RecordedRequest,
  salesforce_test_instance_url,
} from '@connectors/apps/salesforce/salesforce_test_context';
import { describe, expect, it } from 'vitest';

type CompositeBody = { allOrNone: boolean; records: Record<string, unknown>[] };

function read_composite_body(request: RecordedRequest) {
  return request.body as CompositeBody;
}

function build_account_batch(size: number) {
  return {
    records: Array.from({ length: size }, (_unused, offset) => ({
      sobject_type: 'Account',
      fields: { Name: `Account ${offset}` },
    })),
  };
}

function build_success_page(request: RecordedRequest) {
  const [recorded_success] = fixtures.create_records_all_succeeded;
  return read_composite_body(request).records.map((_unused, offset) => ({
    ...recorded_success,
    id: `001RM0000${String(offset).padStart(5, '0')}`,
  }));
}

describe('salesforce-create_records-1 node.json', () => {
  it('takes an array in and returns one result per item', () => {
    expect(definition.node_key).toBe('salesforce-create_records-1');
    expect(definition.implementation).toBe('execute');
    expect(definition.input_schema.properties.records.type).toBe('array');
    expect(definition.input_schema.properties.records.minItems).toBe(1);
    expect(definition.output_schema.properties.results.items.required).toEqual([
      'index',
      'id',
      'success',
      'errors',
    ]);
    expect(definition.atomic).toBe(false);
    expect(definition.quirks.endpoint).toContain('composite/sobjects');
  });

  it('declares a lenient provider ingress that still catches a wrong answer', async () => {
    expect(definition.requests.composite_create.response_schema.items.required).toEqual([
      'success',
    ]);
    const { context } = build_salesforce_test_context(() => [{ success: 'maybe' }]);

    const output = await create_salesforce_records(
      { records: [{ sobject_type: 'Account', fields: { Name: 'Acme Corp' } }] },
      context,
    );

    expect(output.results[0]?.errors[0]?.message).toMatch(/does not match response_schema/u);
  });
});

describe('salesforce-create_records-1 execute', () => {
  it('sends one composite batch to the connection org and keeps per-item results in order', async () => {
    const { context, requests } = build_salesforce_test_context(
      () => fixtures.create_records_mixed_outcome,
    );

    const output = await create_salesforce_records(
      {
        records: [
          { sobject_type: 'Account', fields: { Name: 'Acme Corp' } },
          { sobject_type: 'Contact', fields: { FirstName: 'Ada' } },
        ],
      },
      context,
    );

    expect(requests).toEqual([
      {
        base_url: salesforce_test_instance_url,
        method: 'POST',
        path: '/services/data/v61.0/composite/sobjects',
        query: undefined,
        body: {
          allOrNone: false,
          records: [
            { Name: 'Acme Corp', attributes: { type: 'Account' } },
            { FirstName: 'Ada', attributes: { type: 'Contact' } },
          ],
        },
      },
    ]);
    expect(output).toEqual({
      results: [
        { index: 0, id: '001RM000003oLruYAE', success: true, errors: [] },
        {
          index: 1,
          id: null,
          success: false,
          errors: [
            {
              status_code: 'REQUIRED_FIELD_MISSING',
              message: 'Required fields are missing: [LastName]',
              fields: ['LastName'],
            },
          ],
        },
      ],
    });
    expect(Object.keys(output).sort()).toEqual(list_required_output_keys(definition.output_schema));
  });

  it('splits more than 200 records into whole batches and renumbers nothing', async () => {
    const { context, requests } = build_salesforce_test_context(build_success_page);

    const output = await create_salesforce_records(build_account_batch(201), context);

    expect(requests.map((request) => read_composite_body(request).records.length)).toEqual([
      200, 1,
    ]);
    expect(output.results).toHaveLength(201);
    expect(output.results.map((result) => result.index)).toEqual(
      Array.from({ length: 201 }, (_unused, offset) => offset),
    );
    expect(output.results[200]).toEqual({
      index: 200,
      id: '001RM000000000',
      success: true,
      errors: [],
    });
  });

  it('turns a failed batch into one named failure per record in it', async () => {
    const { context } = build_salesforce_test_context((request) => {
      const { records } = read_composite_body(request);
      if (records.length === 1) throw new Error('salesforce request failed with 503');
      return build_success_page(request);
    });

    const output = await create_salesforce_records(build_account_batch(201), context);

    expect(output.results[199]).toMatchObject({ index: 199, success: true });
    expect(output.results[200]).toEqual({
      index: 200,
      id: null,
      success: false,
      errors: [{ status_code: null, message: 'salesforce request failed with 503', fields: [] }],
    });
  });

  it('writes attributes last so a field named attributes cannot hide the object type', async () => {
    const { context, requests } = build_salesforce_test_context(
      () => fixtures.create_records_all_succeeded,
    );

    await create_salesforce_records(
      { records: [{ sobject_type: 'Account', fields: { attributes: { type: 'Lead' } } }] },
      context,
    );

    const [first_request] = requests;
    if (!first_request) throw new Error('no request was sent');
    expect(read_composite_body(first_request).records[0]).toEqual({
      attributes: { type: 'Account' },
    });
  });
});
