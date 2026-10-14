// biome-ignore-all lint/correctness/useHookAtTopLevel: Repository hook names use snake_case.
import { public_brand_config } from '@coworker/config/public_env';
import { format_error_message } from '@coworker/shared';
import { Input } from '@coworker/ui/components/input';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  type AutomationListItem,
  end_notification,
  list_automations,
  list_notifications,
  type Notification,
} from '@/components/app/automations/automations_api';
import { AutomationsLayout } from '@/components/app/automations/automations_layout';
import { describe_hold_reason } from '@/components/app/automations/fire_outcome_words';
import { NotificationEnd } from '@/components/app/automations/notification_end';
import {
  AppMarks,
  AutomationLine,
  apps_of,
} from '@/components/app/automations/notification_row_context';
import { query_keys } from '@/lib/api/query_keys';

const product_brand_name = public_brand_config.product_brand_name;

const outcome_words: Record<Notification['outcome'], string> = {
  notify_now: 'Told you',
  add_to_daily_summary: 'Saved for the summary',
  add_to_ideas_list: 'Parked',
  drop_with_reason: 'Stayed quiet',
};

type Ending = 'dismiss' | 'act';

export function AttentionActivityPage() {
  const [search, set_search] = useState('');
  const notifications_query = useQuery({
    queryKey: query_keys.notifications(search),
    queryFn: () => list_notifications({ days: 30, q: search.trim() || undefined, page_size: 50 }),
  });
  const end = use_end_notification();
  const automations_query = useQuery({
    queryKey: query_keys.automations(),
    queryFn: list_automations,
  });
  const by_id = new Map((automations_query.data ?? []).map((row) => [row.automation_id, row]));
  const notifications = notifications_query.data?.items ?? [];
  const settled = !notifications_query.isLoading && !notifications_query.isError;

  return (
    <AutomationsLayout current="activity">
      <p className="text-sm text-muted-foreground text-pretty">
        What {product_brand_name} noticed in the last 30 days, and what it decided to do about it.
      </p>
      <label className="sr-only" htmlFor="activity-search">
        Search activity
      </label>
      <Input
        className="mt-4 h-9"
        id="activity-search"
        placeholder="Search"
        type="search"
        value={search}
        onChange={(event) => set_search(event.target.value)}
      />
      {notifications_query.isError ? (
        <p className="mt-6 text-sm">Activity could not be loaded.</p>
      ) : null}
      {settled && notifications.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">Nothing yet.</p>
      ) : null}
      <ul className="mt-6 divide-y border-t">
        {notifications.map((notification) => (
          <NotificationRow
            key={notification.event_id}
            notification={notification}
            automation={by_id.get(notification.notification.automation_id ?? '') ?? null}
            isPending={end.isPending && end.variables?.id === notification.event_id}
            onEnd={(ending) => end.mutate({ id: notification.event_id, ending })}
          />
        ))}
      </ul>
    </AutomationsLayout>
  );
}

function use_end_notification() {
  const query_client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ending }: { id: string; ending: Ending }) => end_notification(id, ending),
    onSuccess: async () => {
      await query_client.invalidateQueries({ queryKey: query_keys.notifications() });
    },
    onError: (error) =>
      toast.error(format_error_message(error, 'Could not update the notification')),
  });
}

function NotificationRow({
  notification,
  automation,
  isPending,
  onEnd,
}: {
  notification: Notification;
  automation: AutomationListItem | null;
  isPending: boolean;
  onEnd: (ending: Ending) => void;
}) {
  const apps = apps_of(automation);
  const said = notification.notification;
  const reason = reason_line_of(notification);
  return (
    <li className="flex flex-col gap-2 py-3.5 sm:flex-row sm:items-start sm:gap-4">
      <div className="w-40 shrink-0 text-sm text-muted-foreground">
        <OutcomeWord outcome={notification.outcome} />
      </div>
      <div className="min-w-0 flex-1 text-sm">
        <div className="flex items-center gap-2">
          <AppMarks apps={apps} />
          <span className="font-medium">{said.title}</span>
        </div>
        <AutomationLine automation={automation} apps={apps} />
        <p className="mt-1 text-muted-foreground">{said.body}</p>
        {reason ? (
          <p className="mt-1 truncate text-muted-foreground" title={reason}>
            {reason}
          </p>
        ) : null}
      </div>
      <NotificationEnd notification={notification} isPending={isPending} onEnd={onEnd} />
    </li>
  );
}

const outcomes_with_reason_line = new Set<Notification['outcome']>([
  'drop_with_reason',
  'add_to_ideas_list',
]);

function reason_line_of(notification: Notification): string | null {
  const said = notification.notification;
  const held_for_summary = notification.outcome === 'add_to_daily_summary' && said.held;
  if (!outcomes_with_reason_line.has(notification.outcome) && !held_for_summary) return null;
  return describe_hold_reason({ held: said.held, outcome_reason: said.outcome_reason });
}

function OutcomeWord({ outcome }: { outcome: Notification['outcome'] }) {
  if (outcome !== 'add_to_ideas_list') return outcome_words[outcome];
  return (
    <Link
      className="underline-offset-4 hover:text-foreground hover:underline"
      to="/automations/ideas"
    >
      {outcome_words[outcome]}
    </Link>
  );
}
