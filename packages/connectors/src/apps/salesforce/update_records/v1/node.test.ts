import {
  build_connection_without_instance_url,
  build_salesforce_test_context,
  list_required_output_keys,
  type RecordedRequest,
  salesforce_test_instance_url,
} from '@connectors/apps/salesforce/salesforce_test_context';
import { update_salesforce_records } from '@connectors/apps/salesforce/update_records/v1/execute';
import fixtures from '@connectors/apps/salesforce/update_records/v1/fixtures.json' with {
  type: 'json',
};
import definition from '@connectors/apps/salesforce/update_records/v1/node.json' with {
  type: 'json',
};
import { describe, expect, it } from 'vitest';

type CompositeBody = { allOrNone: boolean; records: Record<string, unknown>[] };

function read_composite_body(request: RecordedRequest) {
  return request.body as CompositeBody;
}

describe('salesforce-update_records-1 node.json', () => {
  it('requires an id on every item', () => {
    expect(definition.node_key).toBe('salesforce-update_records-1');
    expect(definition.implementation).toBe('execute');
    expect(definition.input_schema.properties.records.items.required).toEqual([
      'sobject_type',
      'id',
      'fields',
    ]);
    expect(definition.quirks.endpoint).toContain('PATCH');
    expect(definition.quirks.partial_update_only).toContain('left alone');
  });

  it('declares a lenient provider ingress that still catches a wrong answer', async () => {
    expect(definition.requests.composite_update.response_schema.items.required).toEqual([
      'success',
    ]);
    const { context } = build_salesforce_test_context(() => [{ success: 'maybe' }]);

    const output = await update_salesforce_records(
      { records: [{ sobject_type: 'Account', id: '001RM000003oCprYAE', fields: { Phone: '1' } }] },
      context,
    );

    expect(output.results[0]?.errors[0]?.message).toMatch(/does not match response_schema/u);
  });
});

describe('salesforce-update_records-1 execute', () => {
  it('PATCHes the composite batch to the connection org with an id per record', async () => {
    const { context, requests } = build_salesforce_test_context(
      () => fixtures.update_records_mixed_outcome,
    );

    const output = await update_salesforce_records(
      {
        records: [
          {
            sobject_type: 'Account',
            id: '001RM000003oCprYAE',
            fields: { BillingCity: 'San Francisco' },
          },
          { sobject_type: 'Account', id: '001xx000003DGb2999', fields: { BillingCity: 'Lisbon' } },
        ],
      },
      context,
    );

    expect(requests).toEqual([
      {
        base_url: salesforce_test_instance_url,
        method: 'PATCH',
        path: '/services/data/v61.0/composite/sobjects',
        query: undefined,
        body: {
          allOrNone: false,
          records: [
            {
              BillingCity: 'San Francisco',
              attributes: { type: 'Account' },
              id: '001RM000003oCprYAE',
            },
            { BillingCity: 'Lisbon', attributes: { type: 'Account' }, id: '001xx000003DGb2999' },
          ],
        },
      },
    ]);
    expect(output).toEqual({
      results: [
        { index: 0, id: '001RM000003oCprYAE', success: true, errors: [] },
        {
          index: 1,
          id: '001RM000003oCptYAE',
          success: false,
          errors: [
            {
              status_code: 'MALFORMED_ID',
              message: 'Account ID: id value of incorrect type: 001xx000003DGb2999',
              fields: ['Id'],
            },
          ],
        },
      ],
    });
    expect(Object.keys(output).sort()).toEqual(list_required_output_keys(definition.output_schema));
  });

  it('sends only the named fields, so an unnamed field is left alone', async () => {
    const { context, requests } = build_salesforce_test_context(
      () => fixtures.update_records_all_succeeded,
    );

    await update_salesforce_records(
      {
        records: [
          {
            sobject_type: 'Account',
            id: '001RM000003oCprYAE',
            fields: { Phone: '+1 415 555 0100' },
          },
        ],
      },
      context,
    );

    const [first_request] = requests;
    if (!first_request) throw new Error('no request was sent');
    expect(read_composite_body(first_request).records[0]).toEqual({
      Phone: '+1 415 555 0100',
      attributes: { type: 'Account' },
      id: '001RM000003oCprYAE',
    });
  });

  it('names the missing instance_url instead of calling the login host', async () => {
    const { context, requests } = build_salesforce_test_context(
      () => fixtures.update_records_all_succeeded,
      build_connection_without_instance_url(),
    );

    const output = await update_salesforce_records(
      { records: [{ sobject_type: 'Account', id: '001RM000003oCprYAE', fields: { Phone: '1' } }] },
      context,
    );

    expect(output.results).toEqual([
      {
        index: 0,
        id: null,
        success: false,
        errors: [
          {
            status_code: null,
            message: expect.stringContaining('has no instance_url'),
            fields: [],
          },
        ],
      },
    ]);
    expect(requests).toEqual([]);
  });
});
