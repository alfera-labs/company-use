import { ChannelRow } from '@/components/app/channel_settings_row';
import {
  ChannelEmptyState,
  ChannelError,
  ChannelLoadingRows,
  ChannelLoadMoreButton,
} from '@/components/app/channel_settings_states';
import {
  can_change_access,
  type SlackSettingsChannel,
} from '@/components/app/slack_settings_channel';

export function ChannelList({
  channels,
  hasMore,
  isFetchingMore,
  isLoading,
  pendingChannelId,
  search,
  totalLoaded,
  error,
  onLoadMore,
  onRetry,
  onSetAccess,
}: {
  channels: SlackSettingsChannel[];
  hasMore: boolean;
  isFetchingMore: boolean;
  isLoading: boolean;
  pendingChannelId: string | null;
  search: string;
  totalLoaded: number;
  error: Error | null;
  onLoadMore: () => void;
  onRetry: () => void;
  onSetAccess: (channel: SlackSettingsChannel, enabled: boolean) => void;
}) {
  if (isLoading) return <ChannelLoadingRows />;
  if (error) return <ChannelError error={error} onRetry={onRetry} />;
  if (channels.length === 0) return <ChannelEmptyState search={search} totalLoaded={totalLoaded} />;

  return (
    <div className="overflow-hidden rounded-2xl border border-border">
      <div className="divide-y divide-border">
        {channels.map((channel) => (
          <ChannelRow
            key={channel.id}
            channel={channel}
            disabled={pendingChannelId !== null || !can_change_access(channel)}
            isPending={pendingChannelId === channel.id}
            onSetAccess={onSetAccess}
          />
        ))}
      </div>
      {hasMore ? (
        <ChannelLoadMoreButton isFetchingMore={isFetchingMore} onLoadMore={onLoadMore} />
      ) : null}
    </div>
  );
}
