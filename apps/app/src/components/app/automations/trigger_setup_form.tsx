import { Button } from '@coworker/ui/components/button';
import { useState } from 'react';
import type { AutomationTriggerInput } from '@/components/app/automations/automations_api';
import {
  empty_schedule_prefill,
  schedule_prefill,
} from '@/components/app/automations/trigger_setup_prefill';
import {
  type ScheduledTaskFrequency,
  ScheduledTaskWhenToRun,
} from '@/components/app/scheduled_task_when_to_run';
import { draft_to_cron } from '@/lib/schedule_builder_model';
import { is_valid_cron } from '@/lib/scheduled_task_schedule';

export function ScheduleSetupForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: AutomationTriggerInput;
  onSave: (input: AutomationTriggerInput) => void;
  onCancel: () => void;
}) {
  const start = initial ? schedule_prefill(initial) : empty_schedule_prefill;
  const [frequency, set_frequency] = useState<ScheduledTaskFrequency>(start.frequency);
  const [draft, set_draft] = useState(start.draft);
  const [advanced_cron, set_advanced_cron] = useState<string | null>(start.advanced_cron);
  const cron = (advanced_cron ?? draft_to_cron(draft) ?? '').trim();
  const timezone = initial?.kind === 'schedule' ? initial.timezone : undefined;

  return (
    <div className="flex w-80 flex-col gap-4">
      <ScheduledTaskWhenToRun
        frequency={frequency}
        onFrequencyChange={set_frequency}
        draft={draft}
        onDraftChange={set_draft}
        advancedCron={advanced_cron}
        onAdvancedCronChange={set_advanced_cron}
      />
      <div className="flex items-center gap-2">
        <Button
          disabled={!is_valid_cron(cron)}
          size="sm"
          type="button"
          onClick={() => onSave({ kind: 'schedule', cron, timezone: timezone ?? local_timezone() })}
        >
          Save
        </Button>
        <Button size="sm" type="button" variant="ghost" onClick={onCancel}>
          Back
        </Button>
      </div>
    </div>
  );
}

export function local_timezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
