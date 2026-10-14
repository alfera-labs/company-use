import { AppError } from '@coworker/shared';
import type { ChannelIngressAdapter } from '@runtime-platform/channels/channel_ingress';
import { email_channel_ingress_adapter } from '@runtime-platform/channels/email/channel_ingress';
import { slack_channel_ingress_adapter } from '@runtime-platform/channels/slack/channel_ingress';

export const channel_ingress_adapters: Record<string, ChannelIngressAdapter> = {
  slack: slack_channel_ingress_adapter,
  email: email_channel_ingress_adapter,
};

export function get_channel_ingress_adapter(channel_provider_key: string): ChannelIngressAdapter {
  const adapter = channel_ingress_adapters[channel_provider_key];
  if (!adapter) {
    throw new AppError('unknown_channel', `Unknown channel: ${channel_provider_key}`, 404);
  }

  return adapter;
}
