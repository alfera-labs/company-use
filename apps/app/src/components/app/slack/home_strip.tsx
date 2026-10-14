import { format_error_message } from '@coworker/shared';
import { Button } from '@coworker/ui/components/button';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useSlackArrival } from '@/components/app/slack/use_slack_arrival';
import { SlackGlyph } from '@/components/onboarding/slack/glyph';
import { get_onboarding, start_slack_connect } from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';
import {
  build_connection_setup_return_url,
  set_connection_setup_return_to,
} from '@/lib/connection_setup_return';

const slack_aubergine = '#4A154B';

const slack_pill_class =
  'ml-auto h-8 shrink-0 gap-2 rounded-full bg-white pl-2.5 font-medium text-[#4A154B] transition-transform duration-150 ease-out hover:bg-white/90 active:scale-[0.97]';

export const HomeSlackStrip = memo(function HomeSlackStrip() {
  const onboarding_query = useQuery({
    queryKey: query_keys.onboarding(),
    queryFn: get_onboarding,
    staleTime: 5 * 60 * 1000,
  });
  const slack = onboarding_query.data?.slack;
  useSlackArrival(useSlackJustAdded() && Boolean(slack?.connected));
  if (onboarding_query.data?.install.slack_app_configured === false) return null;

  return (
    <div
      className="flex h-11 w-full items-center gap-3 px-4 text-sm text-white sm:px-6"
      data-tour="slack-connect"
      style={{ backgroundColor: slack_aubergine }}
    >
      {slack?.connected ? (
        <SlackConnectedContent
          teamId={slack.team_id ?? null}
          botUserId={slack.bot_user_id ?? null}
        />
      ) : (
        <SlackConnectContent />
      )}
    </div>
  );
});

function useSlackJustAdded() {
  const [just_added, set_just_added] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get(slack_added_param) !== '1') return;
    set_just_added(true);
    params.delete(slack_added_param);
    const query = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  }, []);
  return just_added;
}

const slack_added_param = 'slack_added';

function SlackConnectContent() {
  const connect_mutation = useMutation({
    mutationFn: () => {
      set_connection_setup_return_to(`/?${slack_added_param}=1`);
      return start_slack_connect({
        redirect_uri: build_connection_setup_return_url(window.location.origin),
      });
    },
    onSuccess: (result) => {
      if (!result.start_url) {
        toast.error('Could not start the Slack connection. Please try again.');
        return;
      }
      window.location.href = result.start_url;
    },
    onError: (error) => {
      toast.error(format_error_message(error, 'Could not start the Slack connection.'));
    },
  });
  const is_busy = connect_mutation.isPending || connect_mutation.isSuccess;

  return (
    <>
      <SlackGlyph className="size-4 shrink-0" />
      <p className="min-w-0 truncate">
        <span className="font-medium">Bring Alfera into Slack.</span>{' '}
        <span className="text-white/70">Message it directly or mention it in a channel.</span>
      </p>
      <Button
        type="button"
        size="sm"
        aria-busy={is_busy}
        onClick={() => {
          if (!is_busy) connect_mutation.mutate();
        }}
        className={`${slack_pill_class} aria-busy:pointer-events-none`}
      >
        {is_busy ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <SlackGlyph className="size-4" />
        )}
        {is_busy ? 'Opening Slack…' : 'Add to Slack'}
      </Button>
    </>
  );
}

function SlackConnectedContent({
  teamId,
  botUserId,
}: {
  teamId: string | null;
  botUserId: string | null;
}) {
  return (
    <>
      <SlackGlyph className="size-4 shrink-0" />
      <p className="min-w-0 truncate">
        <span className="font-medium">Alfera lives in your Slack.</span>{' '}
        <span className="text-white/70">Message it like a teammate any time.</span>
      </p>
      <a
        href={slack_dm_url(teamId, botUserId)}
        target="_blank"
        rel="noreferrer"
        className={`inline-flex items-center justify-center whitespace-nowrap text-sm ${slack_pill_class} pr-3.5`}
      >
        <SlackGlyph className="size-4" />
        Message your coworker
      </a>
    </>
  );
}

// Build the deep link that opens a direct message with the bot. `slack://user?team=…&id=…` is
// the URI that actually lands in the DM; the web `/client/<team>` path only opens the workspace,
// and slack.com is the last resort when we have no ids. Mirrors the onboarding success step.
function slack_dm_url(teamId: string | null, botUserId: string | null): string {
  if (teamId && botUserId) {
    return `slack://user?team=${encodeURIComponent(teamId)}&id=${encodeURIComponent(botUserId)}`;
  }
  if (teamId) return `https://app.slack.com/client/${encodeURIComponent(teamId)}`;
  return 'https://slack.com';
}
