import { describe, expect, it } from 'vitest';
import type { TriggerTypeCatalog } from '@/components/app/automations/automations_api';
import { chip_value_for } from '@/components/app/automations/trigger_chip_words';
import { setup_problems_of } from '@/components/app/automations/trigger_setup_answers';
import {
  read_setup_fields,
  validate_setup_number,
} from '@/components/app/automations/trigger_setup_fields';

type ApiSetupField =
  TriggerTypeCatalog['apps'][number]['trigger_types'][number]['setup_fields'][number];

const github_pull_request_schema = {
  type: 'object',
  title: 'WebhookConfigSchema',
  required: ['owner', 'repo'],
  properties: {
    repo: { type: 'string', title: 'Repo', description: 'Repository name' },
    owner: { type: 'string', title: 'Owner', description: 'Owner of the repository' },
  },
};

function api_field(name: string, words: Record<string, unknown> = {}): ApiSetupField {
  return {
    name,
    label: name,
    description: null,
    required: false,
    type: 'string',
    has_default: false,
    chip_word: null,
    empty_means: null,
    unit: null,
    hidden_at_default: false,
    choices_from_provider: false,
    minimum: null,
    ...words,
  } as ApiSetupField;
}

describe('read_setup_fields', () => {
  it('turns the GitHub pull-request schema into two required text boxes', () => {
    const api_fields = [
      api_field('repo', { label: 'Repository' }),
      api_field('owner', { label: 'Owner' }),
    ];
    expect(read_setup_fields(github_pull_request_schema, api_fields)).toEqual([
      {
        name: 'repo',
        label: 'Repository',
        description: 'Repository name',
        type: 'string',
        choices: null,
        required: true,
        has_default: false,
        default_value: null,
        minimum: null,
        maximum: null,
        multiple_of: null,
        whole_number: false,
        chip_word: null,
        empty_means: null,
        unit: null,
        hidden_at_default: false,
        choices_from_provider: false,
      },
      {
        name: 'owner',
        label: 'Owner',
        description: 'Owner of the repository',
        type: 'string',
        choices: null,
        required: true,
        has_default: false,
        default_value: null,
        minimum: null,
        maximum: null,
        multiple_of: null,
        whole_number: false,
        chip_word: null,
        empty_means: null,
        unit: null,
        hidden_at_default: false,
        choices_from_provider: false,
      },
    ]);
  });

  it('draws nothing for an ear with nothing to set up, like Gmail new mail', () => {
    expect(read_setup_fields({ type: 'object', properties: {} })).toEqual([]);
  });

  it('keeps an optional number with a default, like Composio polling intervals', () => {
    const [field] = read_setup_fields({
      properties: { interval: { type: 'number', title: 'Interval', default: 2 } },
    });
    expect(field).toMatchObject({ name: 'interval', type: 'number', required: false });
  });

  it('carries the default and the number rules the provider enforces', () => {
    const [field] = read_setup_fields({
      properties: {
        interval: { type: 'integer', default: 1, minimum: 1, maximum: 60, multipleOf: 1 },
      },
    });
    expect(field).toMatchObject({
      default_value: 1,
      minimum: 1,
      maximum: 60,
      multiple_of: 1,
      whole_number: true,
    });
  });
});

describe('validate_setup_number', () => {
  const [bounded] = read_setup_fields({
    properties: { interval: { type: 'number', minimum: 1, maximum: 60, multipleOf: 5 } },
  });
  const [free] = read_setup_fields({ properties: { interval: { type: 'number' } } });

  it('refuses what the provider would refuse, in plain words', () => {
    if (!bounded || !free) throw new Error('no field');
    expect(validate_setup_number(bounded, '0.5')).toBe('At least 1');
    expect(validate_setup_number(bounded, '61')).toBe('At most 60');
    expect(validate_setup_number(bounded, '7')).toBe('In steps of 5');
    expect(validate_setup_number(bounded, '10')).toBeNull();
    expect(validate_setup_number(bounded, '')).toBeNull();
  });

  it('changes nothing when the schema has no bounds', () => {
    if (!free) throw new Error('no field');
    expect(validate_setup_number(free, '0.5')).toBeNull();
  });

  it('refuses a number under the provider floor the API reports, when the schema has none', () => {
    const [interval] = read_setup_fields(
      { properties: { interval: { type: 'number', title: 'Interval', default: 1 } } },
      [api_field('interval', { type: 'number', minimum: 1 })],
    );
    if (!interval) throw new Error('no field');
    expect(validate_setup_number(interval, '0.5')).toBe('At least 1');
    expect(validate_setup_number(interval, '1')).toBeNull();
  });
});

describe('the chip words', () => {
  it("come from the API's setup field, matched by name", () => {
    const [query, labels] = read_setup_fields(
      { properties: { query: { type: 'string', default: '' }, labelIds: { type: 'string' } } },
      [api_field('query', { chip_word: 'matching', empty_means: 'all mail' })],
    );
    expect(query).toMatchObject({ chip_word: 'matching', empty_means: 'all mail' });
    expect(labels).toMatchObject({ chip_word: null, empty_means: null, hidden_at_default: false });
  });
});

describe('a required box whose schema names a default', () => {
  const calendar_catalog = {
    count: 1,
    apps: [
      {
        app_id: 'googlecalendar',
        trigger_types: [
          {
            node_key: 'googlecalendar-event_offset-1',
            setup_fields: [
              api_field('offset_minutes', { has_default: true }),
              api_field('window', { has_default: true }),
              api_field('calendar_id'),
            ],
            input_schema: {
              properties: {
                offset_minutes: { type: 'integer', default: 15 },
                window: { type: 'object', default: { from: 'start', minutes: 15 } },
                calendar_id: { type: 'string' },
              },
              required: ['offset_minutes', 'window', 'calendar_id'],
            },
          },
        ],
      },
    ],
  } as unknown as TriggerTypeCatalog;
  const input = {
    kind: 'app_event' as const,
    node_key: 'googlecalendar-event_offset-1',
    subscription_config: { calendar_id: 'primary' },
    conditions: [],
  };

  it('is not missing, and its chip shows the default instead of "required"', () => {
    expect(setup_problems_of(input, calendar_catalog)).toEqual([]);
    const row = calendar_catalog.apps[0]?.trigger_types[0];
    const [offset, window] = read_setup_fields(row?.input_schema, row?.setup_fields);
    if (!offset || !window) throw new Error('no field');
    expect(chip_value_for(offset, undefined)).toBe('15');
    expect(chip_value_for(window, undefined)).toBe('default');
  });

  it('still refuses a required box with no default left empty', () => {
    const problems = setup_problems_of({ ...input, subscription_config: {} }, calendar_catalog);
    expect(problems.map(({ field, problem }) => [field.name, problem])).toEqual([
      ['calendar_id', 'Required'],
    ]);
  });
});
