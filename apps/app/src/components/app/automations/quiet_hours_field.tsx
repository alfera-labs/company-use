import { Input } from '@coworker/ui/components/input';
import { Label } from '@coworker/ui/components/label';
import { Switch } from '@coworker/ui/components/switch';
import type { NotificationRules } from '@/components/app/automations/automations_api';
import { local_timezone } from '@/components/app/automations/trigger_setup_form';
import type { ChangeRules } from '@/components/app/automations/use_notification_rules_draft';

export function QuietHoursField({
  policy,
  change,
}: {
  policy: NotificationRules;
  change: ChangeRules;
}) {
  const quiet_hours = policy.quiet_hours;
  return (
    <fieldset>
      <legend className="text-sm font-medium">Quiet hours</legend>
      <div className="mt-3 flex items-center gap-2.5 text-sm">
        <Switch
          checked={quiet_hours !== null}
          id="attention-quiet-on"
          onCheckedChange={(on) =>
            change({
              quiet_hours: on
                ? { start: '19:00', end: '08:00', timezone: policy.timezone ?? local_timezone() }
                : null,
            })
          }
        />
        <Label htmlFor="attention-quiet-on">Hold notifications at night</Label>
      </div>
      {quiet_hours ? <QuietHoursTimes quiet_hours={quiet_hours} change={change} /> : null}
    </fieldset>
  );
}

function QuietHoursTimes({
  quiet_hours,
  change,
}: {
  quiet_hours: NonNullable<NotificationRules['quiet_hours']>;
  change: ChangeRules;
}) {
  const set_time = (part: 'start' | 'end', time: string) =>
    change({ quiet_hours: { ...quiet_hours, [part]: time } });
  return (
    <div className="mt-3 flex items-center gap-3 text-sm">
      <Label className="sr-only" htmlFor="attention-quiet-start">
        Quiet hours start
      </Label>
      <Input
        className="h-9 w-32"
        id="attention-quiet-start"
        type="time"
        value={quiet_hours.start}
        onChange={(event) => set_time('start', event.target.value)}
      />
      <span className="text-muted-foreground">to</span>
      <Label className="sr-only" htmlFor="attention-quiet-end">
        Quiet hours end
      </Label>
      <Input
        className="h-9 w-32"
        id="attention-quiet-end"
        type="time"
        value={quiet_hours.end}
        onChange={(event) => set_time('end', event.target.value)}
      />
      <span className="text-muted-foreground">{quiet_hours.timezone}</span>
    </div>
  );
}
