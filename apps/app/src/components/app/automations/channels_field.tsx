import { Label } from '@coworker/ui/components/label';
import { Switch } from '@coworker/ui/components/switch';
import { Mail } from 'lucide-react';
import type { ReactNode } from 'react';
import type { NotificationRules } from '@/components/app/automations/automations_api';
import type { ChangeRules } from '@/components/app/automations/use_notification_rules_draft';
import { BrandMark } from '@/components/app/brand_mark';
import { SlackLogo } from '@/components/auth/provider_logos';

type Channel = NotificationRules['delivery_channel_order'][number];

const channel_choices: { channel: Channel; label: string; mark: ReactNode }[] = [
  { channel: 'slack_dm', label: 'Slack', mark: <SlackLogo /> },
  { channel: 'email', label: 'Email', mark: <Mail aria-hidden="true" className="size-5" /> },
  { channel: 'web', label: 'This app', mark: <BrandMark className="size-5" /> },
];

/**
 * An install that names the ways it has set up offers only those, and a way that is already
 * switched on, so it can be switched off. An install that names none has them all.
 */
export function ChannelsField({
  policy,
  change,
  channels_set_up,
}: {
  policy: NotificationRules;
  change: ChangeRules;
  channels_set_up?: readonly Channel[] | undefined;
}) {
  const offered = channel_choices.filter(
    (choice) =>
      !channels_set_up ||
      channels_set_up.includes(choice.channel) ||
      policy.delivery_channel_order.includes(choice.channel),
  );
  return (
    <fieldset>
      <legend className="text-sm font-medium">Where</legend>
      <div className="mt-3 flex flex-col gap-3">
        {offered.map((choice) => (
          <ChannelRow key={choice.channel} choice={choice} policy={policy} change={change} />
        ))}
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        In this order. The first that reaches you wins.
      </p>
    </fieldset>
  );
}

function ChannelRow({
  choice,
  policy,
  change,
}: {
  choice: (typeof channel_choices)[number];
  policy: NotificationRules;
  change: ChangeRules;
}) {
  const id = `attention-channel-${choice.channel}`;
  const on = policy.delivery_channel_order.includes(choice.channel);
  return (
    <div className="flex items-center gap-2.5">
      {choice.mark}
      <Label className="flex-1" htmlFor={id}>
        {choice.label}
      </Label>
      <Switch
        checked={on}
        id={id}
        onCheckedChange={(next) =>
          change({ delivery_channel_order: next_channels(policy, choice.channel, next) })
        }
      />
    </div>
  );
}

function next_channels(policy: NotificationRules, channel: Channel, wanted: boolean) {
  const channels = policy.delivery_channel_order.filter((one) => one !== channel);
  if (wanted) return [...channels, channel];
  return channels.length > 0 ? channels : policy.delivery_channel_order;
}
