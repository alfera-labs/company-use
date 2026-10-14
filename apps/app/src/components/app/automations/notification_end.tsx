import { Button } from '@coworker/ui/components/button';
import type { Notification } from '@/components/app/automations/automations_api';
import { relative_time } from '@/lib/api';

type Ending = 'dismiss' | 'act';

const answerable_outcomes = new Set<Notification['outcome']>([
  'notify_now',
  'add_to_daily_summary',
]);

export function NotificationEnd({
  notification,
  isPending,
  onEnd,
}: {
  notification: Notification;
  isPending: boolean;
  onEnd: (ending: Ending) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
      <span className="whitespace-nowrap">{relative_time(notification.created_time)}</span>
      <NotificationEndAction notification={notification} isPending={isPending} onEnd={onEnd} />
    </div>
  );
}

function NotificationEndAction({
  notification,
  isPending,
  onEnd,
}: {
  notification: Notification;
  isPending: boolean;
  onEnd: (ending: Ending) => void;
}) {
  if (!answerable_outcomes.has(notification.outcome)) return null;
  if (!notification.is_open) return <span>Answered</span>;
  return (
    <>
      <Button disabled={isPending} size="sm" variant="ghost" onClick={() => onEnd('act')}>
        Done
      </Button>
      <Button disabled={isPending} size="sm" variant="ghost" onClick={() => onEnd('dismiss')}>
        Dismiss
      </Button>
    </>
  );
}
