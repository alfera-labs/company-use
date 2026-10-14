import type { env } from '@coworker/config';
import { native_trigger_node_keys } from '@runtime-platform/tools/native_trigger_seed';

type InstallSettings = Pick<
  typeof env,
  'COWORKER_SELF_HOSTED' | 'SLACK_CLIENT_ID' | 'SLACK_CLIENT_SECRET' | 'INBOUND_EMAIL_DOMAIN'
>;

const channel_is_set_up_by_trigger_node_key: Record<
  string,
  (settings: InstallSettings) => boolean
> = {
  [native_trigger_node_keys.slack_message]: (settings) =>
    Boolean(settings.SLACK_CLIENT_ID && settings.SLACK_CLIENT_SECRET),
  [native_trigger_node_keys.inbound_email]: (settings) => Boolean(settings.INBOUND_EMAIL_DOMAIN),
};

/**
 * A self-hosted install offers the trigger of a channel only when that channel is set up on it.
 * The hosted product has every channel, so its list is never filtered.
 */
export function keep_trigger_nodes_of_set_up_channels<Node extends { node_key: string }>(
  nodes: Node[],
  settings: InstallSettings,
): Node[] {
  if (!settings.COWORKER_SELF_HOSTED) return nodes;
  return nodes.filter(
    (node) => channel_is_set_up_by_trigger_node_key[node.node_key]?.(settings) ?? true,
  );
}
