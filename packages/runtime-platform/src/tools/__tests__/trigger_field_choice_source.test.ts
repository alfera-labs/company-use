import {
  find_field_choice_source,
  read_trigger_field_words,
} from '@runtime-platform/tools/trigger_field_hints';
import { describe, expect, it } from 'vitest';

const stored = (field: string, action_node_name: string) => ({
  field_choices: {
    fingerprint: 'f1',
    fields: {
      [field]: { action_node_name, items_path: ['x'], value_path: ['id'], label_path: ['name'] },
    },
  },
});

describe('where a trigger box gets its options', () => {
  it('uses the stored alias for a box no hint names', () => {
    const config = stored('channel_id', 'list_channels');
    expect(find_field_choice_source('channel_id', 'slack', config)?.action_node_name).toBe(
      'list_channels',
    );
    expect(read_trigger_field_words('channel_id', 'slack', config).choices_from_provider).toBe(
      true,
    );
  });

  it('lets a hand-written hint win over what the sync stored', () => {
    const config = stored('labelIds', 'list_something_else');
    expect(find_field_choice_source('labelIds', 'gmail', config)?.action_node_name).toBe(
      'list_labels',
    );
  });

  it('treats a stored alias that does not parse as no alias', () => {
    const broken = {
      field_choices: { fingerprint: 'f1', fields: { channel_id: { action_node_name: 'x' } } },
    };
    expect(find_field_choice_source('channel_id', 'slack', broken)).toBeNull();
    expect(read_trigger_field_words('channel_id', 'slack', broken).choices_from_provider).toBe(
      false,
    );
  });
});
