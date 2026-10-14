import type { env } from '@coworker/config';
import type { DeliveryChannel } from '@coworker/core/db/schema/automation_contracts';

type InstallSettings = Pick<
  typeof env,
  'COWORKER_SELF_HOSTED' | 'SLACK_CLIENT_ID' | 'SLACK_CLIENT_SECRET' | 'RESEND_API_KEY'
>;

const hosted_delivery_channel_order = ['slack_dm', 'email', 'web'] as const;

const channel_is_set_up: Record<
  (typeof hosted_delivery_channel_order)[number],
  (settings: InstallSettings) => boolean
> = {
  slack_dm: (settings) => Boolean(settings.SLACK_CLIENT_ID && settings.SLACK_CLIENT_SECRET),
  email: (settings) => Boolean(settings.RESEND_API_KEY),
  web: () => true,
};

/**
 * The ways a person is reached when no rules file names any. A self-hosted install names only
 * the channels it has set up; the dashboard is always one of them.
 */
export function default_delivery_channel_order(settings: InstallSettings): DeliveryChannel[] {
  if (!settings.COWORKER_SELF_HOSTED) return [...hosted_delivery_channel_order];
  return hosted_delivery_channel_order.filter((channel) => channel_is_set_up[channel](settings));
}

/** The ways a self-hosted install can reach a person. Null on the hosted product: it has them all. */
export function delivery_channels_of_a_self_host(
  settings: InstallSettings,
): DeliveryChannel[] | null {
  return settings.COWORKER_SELF_HOSTED ? default_delivery_channel_order(settings) : null;
}
