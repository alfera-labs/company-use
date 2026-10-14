import { describe, expect, it } from 'vitest';
import {
  type EditorValue,
  editor_value_to_create_body,
  editor_value_to_update_body,
  empty_editor_value,
} from '@/components/app/automations/automation_editor_model';
import type {
  AutomationTriggerInput,
  TriggerTypeCatalog,
} from '@/components/app/automations/automations_api';

const slack_node = 'composio_slack-channel_message_received-1';

function catalog_with(connections: string[]): TriggerTypeCatalog {
  const app = {
    app_id: 'app_slack',
    app_display_name: 'Slack',
    connections: connections.map((connection_id) => ({
      connection_id,
      connection_name: `Slack ${connection_id}`,
    })),
    trigger_types: [{ node_key: slack_node, display_name: 'New message in a channel' }],
  };
  return { count: 1, apps: [app] } as unknown as TriggerTypeCatalog;
}

function value_with(input: AutomationTriggerInput): EditorValue {
  return {
    ...empty_editor_value(),
    name: 'Answer the team',
    instruction: 'Reply in the thread.',
    triggers: [{ key: 'new_1', input }],
  };
}

const slack_trigger: AutomationTriggerInput = {
  kind: 'app_event',
  node_key: slack_node,
  subscription_config: { channel: 'C1' },
  conditions: [],
};

describe('the account a trigger goes up with', () => {
  it('names the only usable account on create, though no Account box was shown', () => {
    const body = editor_value_to_create_body(
      value_with(slack_trigger),
      catalog_with(['conn_mine']),
    );

    expect(body.triggers).toEqual([{ ...slack_trigger, connection_id: 'conn_mine' }]);
  });

  it('names the picked account on save when there are several, not the first one', () => {
    const picked = { ...slack_trigger, connection_id: 'conn_second' };
    const catalog = catalog_with(['conn_first', 'conn_second']);

    expect(editor_value_to_update_body(value_with(picked), catalog).triggers).toEqual([picked]);
  });

  it('leaves a schedule alone and names nothing for an app nobody connected', () => {
    const schedule: AutomationTriggerInput = { kind: 'schedule', cron: '0 8 * * 1-5' };
    const value = { ...value_with(slack_trigger), triggers: [{ key: 's', input: schedule }] };

    expect(editor_value_to_create_body(value, catalog_with([])).triggers).toEqual([schedule]);
    const unconnected = editor_value_to_create_body(value_with(slack_trigger), catalog_with([]));
    expect(unconnected.triggers).toEqual([slack_trigger]);
  });
});
