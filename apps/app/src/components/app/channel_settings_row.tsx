import { Badge } from '@coworker/ui/components/badge';
import { Checkbox } from '@coworker/ui/components/checkbox';
import { Hash, Loader2, LockKeyhole, Users } from 'lucide-react';
import { ChannelProjectSelect } from '@/components/app/channel_project_select';
import { ChannelGuestSetting } from '@/components/app/channels/channel_guest_setting';
import {
  channel_members_label,
  type SlackSettingsChannel,
} from '@/components/app/slack_settings_channel';

function ChannelRowSummary({ channel }: { channel: SlackSettingsChannel }) {
  return (
    <>
      <div className="grid size-8 place-items-center rounded-2xl bg-muted text-muted-foreground">
        {channel.is_private ? <LockKeyhole className="size-4" /> : <Hash className="size-4" />}
      </div>
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{channel.name}</span>
          <Badge variant={channel.is_enabled ? 'secondary' : 'outline'}>
            {channel.is_enabled ? 'Connected' : 'Off'}
          </Badge>
          {channel.is_private ? <Badge variant="outline">Private</Badge> : null}
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Users className="size-3.5" />
          <span>{channel_members_label(channel)}</span>
        </div>
      </div>
    </>
  );
}

export function ChannelRow({
  channel,
  disabled,
  isPending,
  onSetAccess,
}: {
  channel: SlackSettingsChannel;
  disabled: boolean;
  isPending: boolean;
  onSetAccess: (channel: SlackSettingsChannel, enabled: boolean) => void;
}) {
  return (
    <div className="grid grid-cols-[32px_minmax(0,1fr)_auto_auto_auto] items-center gap-3 px-3 py-3">
      <ChannelRowSummary channel={channel} />
      <ChannelProjectSelect channel={channel} disabled={disabled} />
      {channel.channel_route_id ? (
        <ChannelGuestSetting
          channel_route_id={channel.channel_route_id}
          channel_name={channel.name}
        />
      ) : (
        <span />
      )}
      <div className="grid size-8 place-items-center">
        {isPending ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        ) : (
          <Checkbox
            aria-label={`${channel.is_enabled ? 'Remove' : 'Add'} Alfera ${channel.name}`}
            checked={channel.is_enabled}
            disabled={disabled}
            onCheckedChange={(checked) => onSetAccess(channel, checked === true)}
          />
        )}
      </div>
    </div>
  );
}
