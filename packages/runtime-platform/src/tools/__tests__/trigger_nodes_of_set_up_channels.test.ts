import { native_trigger_node_keys } from '@runtime-platform/tools/native_trigger_seed';
import { keep_trigger_nodes_of_set_up_channels } from '@runtime-platform/tools/trigger_nodes_of_set_up_channels';
import { describe, expect, it } from 'vitest';

const nodes = [
  { node_key: native_trigger_node_keys.slack_message },
  { node_key: native_trigger_node_keys.inbound_email },
  { node_key: native_trigger_node_keys.notification_written },
  { node_key: 'mail_fixture-message_received-1' },
];

const no_channel = {
  SLACK_CLIENT_ID: undefined,
  SLACK_CLIENT_SECRET: undefined,
  INBOUND_EMAIL_DOMAIN: undefined,
};

function kept_keys(settings: Parameters<typeof keep_trigger_nodes_of_set_up_channels>[1]) {
  return keep_trigger_nodes_of_set_up_channels(nodes, settings).map((node) => node.node_key);
}

describe('the triggers an install offers', () => {
  it('keeps every trigger on the hosted product, whatever is set', () => {
    expect(
      keep_trigger_nodes_of_set_up_channels(nodes, { ...no_channel, COWORKER_SELF_HOSTED: false }),
    ).toBe(nodes);
  });

  it('leaves out the Slack and the email trigger on a self-host with neither channel', () => {
    expect(kept_keys({ ...no_channel, COWORKER_SELF_HOSTED: true })).toEqual([
      native_trigger_node_keys.notification_written,
      'mail_fixture-message_received-1',
    ]);
  });

  it('offers the trigger of each channel a self-host has set up', () => {
    const with_slack = {
      ...no_channel,
      COWORKER_SELF_HOSTED: true,
      SLACK_CLIENT_ID: '123.456',
      SLACK_CLIENT_SECRET: 'filler',
    };

    expect(kept_keys(with_slack)).toContain(native_trigger_node_keys.slack_message);
    expect(kept_keys(with_slack)).not.toContain(native_trigger_node_keys.inbound_email);
    expect(kept_keys({ ...with_slack, INBOUND_EMAIL_DOMAIN: 'mail.example.com' })).toHaveLength(
      nodes.length,
    );
  });

  it('needs both Slack values, as the Slack sign-in does', () => {
    const half = { ...no_channel, COWORKER_SELF_HOSTED: true, SLACK_CLIENT_ID: '123.456' };

    expect(kept_keys(half)).not.toContain(native_trigger_node_keys.slack_message);
  });
});
