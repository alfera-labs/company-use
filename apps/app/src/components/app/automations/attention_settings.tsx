// biome-ignore-all lint/correctness/useHookAtTopLevel: Repository hook names use snake_case.
import { Input } from '@coworker/ui/components/input';
import { Label } from '@coworker/ui/components/label';
import { Skeleton } from '@coworker/ui/components/skeleton';
import { Textarea } from '@coworker/ui/components/textarea';
import type { NotificationRules } from '@/components/app/automations/automations_api';
import { ChannelsField } from '@/components/app/automations/channels_field';
import { NotifyMeField } from '@/components/app/automations/notify_me_field';
import { QuietHoursField } from '@/components/app/automations/quiet_hours_field';
import {
  type ChangeRules,
  use_notification_rules_draft,
} from '@/components/app/automations/use_notification_rules_draft';

const notifications_per_day_hard_ceiling = 15;

type FieldProps = { policy: NotificationRules; change: ChangeRules };

export function AttentionSettings() {
  const { policy_query, policy, change } = use_notification_rules_draft();
  if (policy_query.isError) return <p className="text-sm">These settings could not be loaded.</p>;
  if (!policy) return <Skeleton className="h-64 w-full" />;
  return (
    <div className="flex flex-col gap-8">
      <NotifyMeField policy={policy} change={change} />
      <DailyMostField policy={policy} change={change} />
      <QuietHoursField policy={policy} change={change} />
      <ChannelsField
        policy={policy}
        change={change}
        channels_set_up={policy_query.data?.delivery_channels_set_up}
      />
      <DailySummaryTimeField policy={policy} change={change} />
      <GuidanceField
        guidance={policy_query.data?.guidance ?? ''}
        may_edit={policy_query.data?.may_edit_guidance === true}
        version={policy_query.data?.policy_hash}
        change={change}
      />
    </div>
  );
}

function DailyMostField({ policy, change }: FieldProps) {
  return (
    <fieldset>
      <legend className="text-sm font-medium" id="attention-daily-most-label">
        At most, in a day
      </legend>
      <Input
        aria-labelledby="attention-daily-most-label"
        className="mt-3 h-9 w-24"
        defaultValue={policy.max_notifications_per_day}
        id="attention-daily-most"
        max={notifications_per_day_hard_ceiling}
        min={0}
        type="number"
        onBlur={(event) => {
          const most = Number(event.target.value);
          if (Number.isInteger(most) && most !== policy.max_notifications_per_day) {
            change({ max_notifications_per_day: most });
          }
        }}
      />
    </fieldset>
  );
}

function DailySummaryTimeField({ policy, change }: FieldProps) {
  return (
    <fieldset>
      <legend className="text-sm font-medium">Daily summary</legend>
      <div className="mt-3 flex items-center gap-2.5 text-sm">
        <Label htmlFor="attention-daily-summary-time">
          Arrives {policy.daily_summary_cadence} at
        </Label>
        <Input
          className="h-9 w-32"
          id="attention-daily-summary-time"
          type="time"
          value={policy.daily_summary_at_time}
          onChange={(event) => change({ daily_summary_at_time: event.target.value })}
        />
      </div>
    </fieldset>
  );
}

function GuidanceField({
  guidance,
  may_edit,
  version,
  change,
}: {
  guidance: string;
  may_edit: boolean;
  version: string | undefined;
  change: ChangeRules;
}) {
  return (
    <fieldset>
      <legend className="text-sm font-medium" id="attention-guidance-label">
        In your own words
      </legend>
      <p className="mt-1 text-sm text-muted-foreground" id="attention-guidance-hint">
        {may_edit
          ? 'This is judgment, not a rule: it shapes what counts as worth your attention.'
          : 'Every automation in this workspace reads this. Only an owner or an admin can change it.'}
      </p>
      <Textarea
        aria-describedby="attention-guidance-hint"
        aria-labelledby="attention-guidance-label"
        className="mt-3 min-h-40"
        defaultValue={guidance}
        id="attention-guidance"
        key={version}
        readOnly={!may_edit}
        onBlur={(event) => {
          if (may_edit && event.target.value !== guidance) change({ guidance: event.target.value });
        }}
      />
    </fieldset>
  );
}
