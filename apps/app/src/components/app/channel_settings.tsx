import { format_error_message } from '@coworker/shared';
import { Input } from '@coworker/ui/components/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@coworker/ui/components/tabs';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { SlackNotSetUpNote } from '@/components/app/channel_not_set_up_notes';
import { ChannelList } from '@/components/app/channel_settings_list';
import { ChannelLoadingRows } from '@/components/app/channel_settings_states';
import { EmptyNote } from '@/components/app/empty_note';
import {
  filter_channels,
  type SlackSettingsChannel,
} from '@/components/app/slack_settings_channel';
import {
  get_onboarding,
  list_slack_channel_settings,
  type SlackChannelSettingsVisibility,
  set_slack_channel_access,
} from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';

const channel_visibility_tabs = [
  { value: 'public', label: 'Public' },
  { value: 'private', label: 'Private' },
] satisfies { value: SlackChannelSettingsVisibility; label: string }[];

/**
 * The channels page asks for the channels only when Slack is connected. Until then it says
 * what is missing, so a workspace with no Slack sees no error and sends no failing request.
 */
export function ChannelSettings() {
  const onboarding_query = useQuery({
    queryKey: query_keys.onboarding(),
    queryFn: get_onboarding,
    staleTime: 5 * 60 * 1000,
  });
  if (onboarding_query.isLoading) return <ChannelLoadingRows />;
  const onboarding = onboarding_query.data;
  if (onboarding?.install.slack_app_configured === false) return <SlackNotSetUpNote />;
  if (onboarding && !onboarding.slack.connected) return <SlackNotConnectedNote />;
  return <ConnectedChannelSettings />;
}

function SlackNotConnectedNote() {
  return (
    <EmptyNote>
      Slack is not connected yet.{' '}
      <Link className="underline underline-offset-4 hover:text-foreground" to="/integrations">
        Connect Slack
      </Link>
      , then choose on this page the channels where your coworker answers.
    </EmptyNote>
  );
}

function ConnectedChannelSettings() {
  const [visibility, set_visibility] = useState<SlackChannelSettingsVisibility>('public');
  const [search, set_search] = useState('');
  const channels_query = useChannelSettingsQuery(visibility);
  const access = useChannelAccessMutation();
  const channels = channels_query.data?.pages.flatMap((page) => page.channels) ?? [];
  const visible_channels = useMemo(() => filter_channels(channels, search), [channels, search]);

  return (
    <Tabs
      value={visibility}
      className="gap-4"
      onValueChange={(value) => {
        if (value === 'public' || value === 'private') set_visibility(value);
      }}
    >
      <ChannelSettingsToolbar search={search} onSearchChange={set_search} />
      <TabsContent value={visibility}>
        <ChannelList
          channels={visible_channels}
          hasMore={Boolean(channels_query.hasNextPage)}
          isFetchingMore={channels_query.isFetchingNextPage}
          isLoading={channels_query.isLoading}
          pendingChannelId={access.pending_channel_id}
          search={search}
          totalLoaded={channels.length}
          error={channels_query.error}
          onLoadMore={() => void channels_query.fetchNextPage()}
          onRetry={() => void channels_query.refetch()}
          onSetAccess={access.set_access}
        />
      </TabsContent>
    </Tabs>
  );
}

function ChannelSettingsToolbar({
  search,
  onSearchChange,
}: {
  search: string;
  onSearchChange: (search: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <TabsList variant="line">
        {channel_visibility_tabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      <label className="relative w-full sm:max-w-xs" htmlFor="channel-settings-search">
        <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 size-4 text-muted-foreground" />
        <Input
          id="channel-settings-search"
          className="h-9 pl-9"
          type="search"
          value={search}
          placeholder="Search channels"
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </label>
    </div>
  );
}

function useChannelAccessMutation() {
  const query_client = useQueryClient();
  const access_mutation = useMutation({
    mutationFn: set_slack_channel_access,
    onSuccess: async (_, input) => {
      toast.success(input.enabled ? 'Channel connected' : 'Channel disconnected');
      await query_client.invalidateQueries({ queryKey: query_keys.slack_channel_settings() });
    },
    onError: (error) => toast.error(format_error_message(error, 'Could not update channel')),
  });

  return {
    pending_channel_id: access_mutation.isPending
      ? (access_mutation.variables?.channel_id ?? null)
      : null,
    set_access: (channel: SlackSettingsChannel, enabled: boolean) =>
      access_mutation.mutate({ channel_id: channel.id, enabled }),
  };
}

function useChannelSettingsQuery(visibility: SlackChannelSettingsVisibility) {
  return useInfiniteQuery({
    queryKey: query_keys.slack_channel_settings(visibility),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      list_slack_channel_settings({
        visibility,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    getNextPageParam: (last_page) => last_page.next_cursor ?? undefined,
  });
}
