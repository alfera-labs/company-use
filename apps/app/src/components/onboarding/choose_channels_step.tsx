import { format_error_message } from '@coworker/shared';
import { Button } from '@coworker/ui/components/button';
import { Checkbox } from '@coworker/ui/components/checkbox';
import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { ChevronLeft, Info, Loader2, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { join_slack_channels, list_slack_channels } from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';

type ChannelsMode = 'options' | 'select';

export function ChooseChannelsStep({
  agentLabel,
  workspaceName,
  onAdvance,
}: {
  agentLabel: string;
  workspaceName: string;
  onAdvance: () => void;
}) {
  const [mode, set_mode] = useState<ChannelsMode>('options');
  const [search, set_search] = useState('');
  const [selected, set_selected] = useState<Set<string>>(new Set());

  const channels_query = useInfiniteQuery({
    queryKey: query_keys.slack_channels(),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => list_slack_channels(pageParam ? { cursor: pageParam } : {}),
    getNextPageParam: (last_page) => last_page.next_cursor ?? undefined,
  });

  const channels = useMemo(
    () => channels_query.data?.pages.flatMap((page) => page.channels) ?? [],
    [channels_query.data],
  );

  const join_mutation = useMutation({
    mutationFn: join_slack_channels,
    onSuccess: (result) => {
      toast.success(
        result.joined > 0
          ? `Added ${agentLabel} to ${result.joined} channel${result.joined === 1 ? '' : 's'}`
          : `${agentLabel} is ready`,
      );
      onAdvance();
    },
    onError: (error) => toast.error(format_error_message(error, 'Could not invite to channels.')),
  });

  const is_loading = channels_query.isLoading;
  const channel_count = channels.length;
  const has_more = channels_query.hasNextPage;
  const count_label = has_more ? `${channel_count}+` : `${channel_count}`;

  if (mode === 'select') {
    return (
      <SelectChannelsView
        agentLabel={agentLabel}
        workspaceName={workspaceName}
        channels={channels}
        search={search}
        selected={selected}
        isLoading={is_loading}
        isFetchingMore={channels_query.isFetchingNextPage}
        hasMore={Boolean(has_more)}
        isJoining={join_mutation.isPending}
        onSearch={set_search}
        onToggle={(id) => set_selected((current) => toggle_set(current, id))}
        onLoadMore={() => void channels_query.fetchNextPage()}
        onBack={() => set_mode('options')}
        onJoin={() => join_mutation.mutate({ channel_ids: [...selected] })}
      />
    );
  }

  return (
    <div className="ob-step ob-step--center ob-animate">
      <div className="ob-head">
        <h1 className="ob-title">
          Which channels should {agentLabel} <span className="ob-accent">join?</span>
        </h1>
        <p className="ob-subtitle">
          {is_loading
            ? `Looking for public channels in ${workspaceName}…`
            : channel_count === 0
              ? `We didn't find public channels in ${workspaceName}. You can add ${agentLabel} to channels anytime.`
              : `We found ${count_label} public channel${channel_count === 1 ? '' : 's'} in ${workspaceName}.`}
        </p>
      </div>

      {channel_count === 0 && !is_loading ? (
        <div className="ob-actions">
          <Button className="h-12 w-full text-[15px]" type="button" onClick={onAdvance}>
            Continue
          </Button>
        </div>
      ) : (
        <div className="ob-card">
          <Button
            className="h-12 w-full text-[15px]"
            type="button"
            disabled={is_loading || join_mutation.isPending}
            onClick={() => join_mutation.mutate({ all_public: true })}
          >
            {join_mutation.isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : null}
            Invite {agentLabel} to public channels only
          </Button>
          <Button
            className="h-11 w-full"
            type="button"
            variant="ghost"
            disabled={is_loading}
            onClick={() => set_mode('select')}
          >
            Select channels
          </Button>
        </div>
      )}

      <p className="ob-hint">
        <Info className="size-4" aria-hidden="true" />
        You can remove {agentLabel} from any channel anytime.
      </p>
    </div>
  );
}

function SelectChannelsView({
  agentLabel,
  workspaceName,
  channels,
  search,
  selected,
  isLoading,
  isFetchingMore,
  hasMore,
  isJoining,
  onSearch,
  onToggle,
  onLoadMore,
  onBack,
  onJoin,
}: {
  agentLabel: string;
  workspaceName: string;
  channels: { id: string; name: string; num_members: number | null }[];
  search: string;
  selected: Set<string>;
  isLoading: boolean;
  isFetchingMore: boolean;
  hasMore: boolean;
  isJoining: boolean;
  onSearch: (value: string) => void;
  onToggle: (id: string) => void;
  onLoadMore: () => void;
  onBack: () => void;
  onJoin: () => void;
}) {
  const normalized = search.trim().toLowerCase();
  const visible = normalized
    ? channels.filter((channel) => channel.name.toLowerCase().includes(normalized))
    : channels;

  return (
    <div className="ob-step ob-animate">
      <button type="button" className="ob-back" onClick={onBack}>
        <ChevronLeft className="size-4" aria-hidden="true" />
        Back
      </button>

      <div className="ob-head">
        <h1 className="ob-title">
          Select channels for {agentLabel} to <span className="ob-accent">join</span>
        </h1>
      </div>

      <div className="ob-search">
        <Search className="size-4" aria-hidden="true" />
        <input
          type="search"
          value={search}
          placeholder={`Search ${workspaceName} workspace`}
          onChange={(event) => onSearch(event.target.value)}
          aria-label="Search channels"
        />
      </div>

      <div className="ob-list">
        <div className="ob-list__head">
          <span>{selected.size} selected</span>
        </div>
        <div className="ob-list__scroll">
          {isLoading ? (
            <div className="ob-empty">Loading channels…</div>
          ) : visible.length === 0 ? (
            <div className="ob-empty">No channels match “{search}”.</div>
          ) : (
            visible.map((channel) => {
              const is_checked = selected.has(channel.id);
              return (
                <button
                  key={channel.id}
                  type="button"
                  className="ob-row"
                  aria-pressed={is_checked}
                  onClick={() => onToggle(channel.id)}
                >
                  <span className="ob-row__hash">#</span>
                  <span className="ob-row__name">{channel.name}</span>
                  <Checkbox checked={is_checked} className="pointer-events-none" tabIndex={-1} />
                </button>
              );
            })
          )}
          {hasMore ? (
            <div className="ob-list__more">
              <Button
                size="sm"
                type="button"
                variant="ghost"
                disabled={isFetchingMore}
                onClick={onLoadMore}
              >
                {isFetchingMore ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : null}
                Load more
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="ob-actions">
        <Button
          className="h-12 w-full text-[15px]"
          type="button"
          disabled={selected.size === 0 || isJoining}
          onClick={onJoin}
        >
          {isJoining ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          Invite {agentLabel} to {selected.size} channel{selected.size === 1 ? '' : 's'}
        </Button>
      </div>

      <p className="ob-hint">
        <Info className="size-4" aria-hidden="true" />
        You can remove {agentLabel} from any channel anytime.
      </p>
    </div>
  );
}

function toggle_set(current: Set<string>, id: string) {
  const next = new Set(current);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}
