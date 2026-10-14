import { create_llm_gateway } from '@agent-core/llm_gateway';
import { create_fake_llm_adapter } from '@agent-core/llm_gateway/adapters/fake_llm_adapter';
import type { NodeConfigData } from '@coworker/core/db/schema/json_column_types';
import { add_field_choices } from '@runtime-platform/catalog/field_choices/add_field_choices';
import {
  keep_what_was_shown,
  names_the_same_thing,
} from '@runtime-platform/catalog/field_choices/ask_for_field_choices';
import {
  collect_field_choice_candidates,
  describe_lists,
} from '@runtime-platform/catalog/field_choices/field_choice_candidates';
import { describe, expect, it, vi } from 'vitest';

const labels_output = {
  type: 'object',
  properties: {
    data: {
      type: 'object',
      properties: {
        labels: {
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

type TestSeed = {
  node_kind: string;
  node_name: string;
  input_schema: unknown;
  output_schema?: unknown;
  metadata?: unknown;
  node_config: NodeConfigData;
};

const seeds = (): TestSeed[] => [
  {
    node_kind: 'trigger',
    node_name: 'new_message',
    input_schema: {
      properties: {
        labelIds: { type: 'string', description: 'Label to watch' },
        query: { type: 'string' },
        interval: { type: 'number' },
        include_spam: { type: 'boolean' },
        mode: { type: 'string', enum: ['all', 'unread'] },
      },
    },
    node_config: { sourced_from: { provider_app_id: 'gmail' } },
  },
  {
    node_kind: 'trigger',
    node_name: 'email_sent',
    input_schema: { properties: { query: { type: 'string' } } },
    node_config: {},
  },
  {
    node_kind: 'action',
    node_name: 'list_labels',
    input_schema: {
      properties: { user_id: { type: 'string', default: 'me' } },
      required: ['user_id'],
    },
    output_schema: labels_output,
    metadata: { description: 'Lists all labels in the mailbox.' },
    node_config: {},
  },
  {
    node_kind: 'action',
    node_name: 'list_messages',
    input_schema: { properties: { label_id: { type: 'string' } }, required: ['label_id'] },
    node_config: {},
  },
  { node_kind: 'action', node_name: 'send_email', input_schema: {}, node_config: {} },
];

const model_answer = JSON.stringify({
  aliases: [
    {
      field: 'labelIds',
      action: 'list_labels',
      items_path: ['data', 'labels'],
      value_path: ['id'],
      label_path: ['name'],
    },
    {
      field: 'query',
      action: 'invented_action',
      items_path: [],
      value_path: ['id'],
      label_path: ['name'],
    },
    {
      field: 'not_a_box',
      action: 'list_labels',
      items_path: [],
      value_path: ['id'],
      label_path: ['name'],
    },
  ],
});

function fake_gateway(answer = model_answer) {
  const respond = vi.fn(() => answer);
  const gateway = create_llm_gateway({
    adapter: create_fake_llm_adapter(respond),
    environment: { OPENAI_API_KEY: 'test-openai-key' },
  });
  return { gateway, respond };
}

describe('the candidates a model is shown', () => {
  it('offers boxes that could hold a picked thing, and list actions that need no input', () => {
    const candidates = collect_field_choice_candidates(seeds());
    expect(candidates.fields.map((field) => field.name)).toEqual(['labelIds', 'query']);
    expect(candidates.actions.map((action) => action.node_name)).toEqual(['list_labels']);
  });

  it('describes where the list sits in an answer', () => {
    expect(describe_lists(labels_output)).toEqual(['data.labels[]: id, name']);
  });
});

describe('adding aliases during the sync', () => {
  it('asks once per app and writes each trigger only its own boxes', async () => {
    const { gateway, respond } = fake_gateway();
    const result = await add_field_choices({
      app_display_name: 'Gmail',
      seeds: seeds(),
      existing_node_configs: [],
      ask: true,
      gateway,
    });
    expect(result.outcome).toBe('asked');
    expect(respond).toHaveBeenCalledTimes(1);
    const [new_message, email_sent] = result.seeds;
    expect(new_message?.node_config.field_choices?.fields).toEqual({
      labelIds: {
        action_node_name: 'list_labels',
        items_path: ['data', 'labels'],
        value_path: ['id'],
        label_path: ['name'],
      },
    });
    expect(email_sent?.node_config.field_choices?.fields).toEqual({});
    expect(new_message?.node_config.sourced_from).toEqual({ provider_app_id: 'gmail' });
  });

  it('reuses what is stored when nothing changed, without asking again', async () => {
    const first = await add_field_choices({
      app_display_name: 'Gmail',
      seeds: seeds(),
      existing_node_configs: [],
      ask: true,
      gateway: fake_gateway().gateway,
    });
    const { gateway, respond } = fake_gateway();
    const again = await add_field_choices({
      app_display_name: 'Gmail',
      seeds: seeds(),
      existing_node_configs: first.seeds.map((seed) => seed.node_config),
      ask: true,
      gateway,
    });
    expect(again.outcome).toBe('reused');
    expect(respond).not.toHaveBeenCalled();
    expect(again.seeds[0]?.node_config.field_choices?.fields.labelIds?.action_node_name).toBe(
      'list_labels',
    );
  });

  it('drops a stored alias that no longer passes the checks, without asking again', async () => {
    const bad = {
      field_choices: {
        fingerprint: '',
        fields: {
          labelIds: {
            action_node_name: 'list_labels',
            items_path: [],
            value_path: ['id'],
            label_path: ['name'],
          },
          query: {
            action_node_name: 'list_labels',
            items_path: [],
            value_path: ['id'],
            label_path: ['name'],
          },
        },
      },
    };
    const first = await add_field_choices({
      app_display_name: 'Gmail',
      seeds: seeds(),
      existing_node_configs: [],
      ask: true,
      gateway: fake_gateway().gateway,
    });
    const fingerprint = first.seeds[0]?.node_config.field_choices?.fingerprint ?? '';
    const stored = { field_choices: { ...bad.field_choices, fingerprint } };
    const { gateway, respond } = fake_gateway();
    const again = await add_field_choices({
      app_display_name: 'Gmail',
      seeds: seeds(),
      existing_node_configs: [stored],
      ask: true,
      gateway,
    });
    expect(respond).not.toHaveBeenCalled();
    expect(Object.keys(again.seeds[0]?.node_config.field_choices?.fields ?? {})).toEqual([
      'labelIds',
    ]);
  });

  it('keeps what was stored when this run cannot ask a model', async () => {
    const first = await add_field_choices({
      app_display_name: 'Gmail',
      seeds: seeds(),
      existing_node_configs: [],
      ask: true,
      gateway: fake_gateway().gateway,
    });
    const changed = seeds().map((seed) =>
      seed.node_name === 'send_email' ? { ...seed, node_name: 'list_drafts' } : seed,
    );
    const kept = await add_field_choices({
      app_display_name: 'Gmail',
      seeds: changed,
      existing_node_configs: first.seeds.map((seed) => seed.node_config),
      ask: false,
    });
    expect(kept.outcome).toBe('kept_previous');
    expect(kept.seeds[0]?.node_config.field_choices?.fields.labelIds?.action_node_name).toBe(
      'list_labels',
    );
  });

  it('asks nothing for an app with no list action', async () => {
    const { gateway, respond } = fake_gateway();
    const only_triggers = seeds().filter((seed) => seed.node_kind === 'trigger');
    const result = await add_field_choices({
      app_display_name: 'Gmail',
      seeds: only_triggers,
      existing_node_configs: [],
      ask: true,
      gateway,
    });
    expect(result.outcome).toBe('nothing_to_map');
    expect(respond).not.toHaveBeenCalled();
  });
});

describe('checking what the model answered', () => {
  it('keeps an alias only when the box and the action name the same thing', () => {
    const pulls = {
      node_name: 'find_pull_requests',
      lists: ['pull_requests[]: id, title, labels'],
    };
    expect(names_the_same_thing('labels', pulls)).toBe(false);
    expect(names_the_same_thing('labelIds', { node_name: 'list_labels', lists: [] })).toBe(true);
    expect(names_the_same_thing('folder_id', { node_name: 'list_mail_folders', lists: [] })).toBe(
      true,
    );
    expect(names_the_same_thing('repo', { node_name: 'list_repositories', lists: [] })).toBe(true);
  });

  it('drops one bad alias and keeps the good one beside it', () => {
    const candidates = {
      fields: [
        { name: 'database_id', description: '' },
        { name: 'page_id', description: '' },
      ],
      actions: [
        { node_name: 'list_databases', description: '', lists: ['results[]: id, title'] },
        { node_name: 'list_pages', description: '', lists: ['results[]: id, title'] },
      ],
    };
    const kept = keep_what_was_shown(
      [
        {
          field: 'page_id',
          action: 'list_pages',
          items_path: ['results'],
          value_path: ['id'],
          label_path: ['title', 0, 'plain_text'],
        },
        {
          field: 'database_id',
          action: 'list_databases',
          items_path: ['results'],
          value_path: ['id'],
          label_path: ['title'],
        },
      ],
      candidates,
    );
    expect(Object.keys(kept)).toEqual(['database_id']);
  });

  it('ranks list actions first when an app has more actions than fit', () => {
    const many = Array.from({ length: 130 }, (_, index) => ({
      node_kind: 'action',
      node_name: `get_a_${String(index).padStart(3, '0')}`,
      input_schema: {},
      node_config: {},
    }));
    const candidates = collect_field_choice_candidates([
      ...many,
      { node_kind: 'action', node_name: 'list_repositories', input_schema: {}, node_config: {} },
    ]);
    expect(candidates.actions[0]?.node_name).toBe('list_repositories');
  });
});
