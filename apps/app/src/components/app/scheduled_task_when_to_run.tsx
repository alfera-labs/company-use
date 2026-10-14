import { Button } from '@coworker/ui/components/button';
import { Input } from '@coworker/ui/components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@coworker/ui/components/select';
import { cn } from '@coworker/ui/lib/utils';
import { Clock3 } from 'lucide-react';
import { useState } from 'react';
import {
  draft_to_cron,
  type ScheduleDraft,
  type ScheduleIntervalUnit,
  type Weekday,
  weekday_order,
} from '@/lib/schedule_builder_model';
import { is_valid_cron } from '@/lib/scheduled_task_schedule';

export type ScheduledTaskFrequency =
  | 'every_day'
  | 'every_weekday'
  | 'every_week'
  | 'selected_days'
  | 'every_month'
  | 'every_hour'
  | 'interval'
  | 'manual'
  | 'run_once'
  | 'custom';

const frequencies: ReadonlyArray<{ value: ScheduledTaskFrequency; label: string }> = [
  { value: 'every_day', label: 'every day' },
  { value: 'every_weekday', label: 'every weekday' },
  { value: 'every_week', label: 'every week' },
  { value: 'selected_days', label: 'on selected days' },
  { value: 'every_month', label: 'every month' },
  { value: 'every_hour', label: 'every hour' },
  { value: 'interval', label: 'at an interval of' },
  { value: 'manual', label: 'manually' },
  { value: 'run_once', label: 'Run once' },
  { value: 'custom', label: 'custom schedule' },
];
const units: ReadonlyArray<{ value: ScheduleIntervalUnit; label: string }> = [
  { value: 'minutes', label: 'minutes' },
  { value: 'hours', label: 'hours' },
  { value: 'days', label: 'calendar days' },
];
const custom_labels = [
  'Minute (0–59)',
  'Hour (0–23)',
  'Day (1–31)',
  'Month (1–12)',
  'Weekday (0–7)',
];
const hours = Array.from({ length: 24 }, (_, value) => value);
const minutes = Array.from({ length: 60 }, (_, value) => value);
const month_days = Array.from({ length: 31 }, (_, index) => index + 1);

export function ScheduledTaskWhenToRun({
  frequency,
  onFrequencyChange,
  draft,
  onDraftChange,
  advancedCron,
  onAdvancedCronChange,
}: {
  frequency: ScheduledTaskFrequency;
  onFrequencyChange: (frequency: ScheduledTaskFrequency) => void;
  draft: ScheduleDraft;
  onDraftChange: (draft: ScheduleDraft) => void;
  advancedCron: string | null;
  onAdvancedCronChange: (cron: string | null) => void;
}) {
  const [custom_fields, set_custom_fields] = useState(() =>
    custom_values(advancedCron ?? draft_to_cron(draft) ?? '* * * * *'),
  );
  const [custom_initialized, set_custom_initialized] = useState(false);
  const set_draft = (patch: Partial<ScheduleDraft>) => onDraftChange({ ...draft, ...patch });

  const select_frequency = (next: ScheduledTaskFrequency) => {
    onFrequencyChange(next);
    if (next === 'custom') {
      const fields = custom_initialized
        ? custom_fields
        : custom_values(draft_to_cron(draft) ?? '* * * * *');
      set_custom_fields(fields);
      set_custom_initialized(true);
      onAdvancedCronChange(valid_custom_fields(fields) ? fields.join(' ') : '');
      return;
    }
    onAdvancedCronChange(null);
    const next_draft = frequency_to_draft(next, draft);
    if (next_draft) onDraftChange(next_draft);
  };

  const update_custom_field = (index: number, value: string) => {
    const next = [...custom_fields];
    next[index] = value;
    set_custom_fields(next);
    set_custom_initialized(true);
    onAdvancedCronChange(valid_custom_fields(next) ? next.join(' ') : '');
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Run</span>
        <Select
          value={frequency}
          onValueChange={(value) => select_frequency(value as ScheduledTaskFrequency)}
        >
          <SelectTrigger className="h-9 min-w-32 rounded-xl" aria-label="Run frequency">
            <SelectValue>{frequencies.find((item) => item.value === frequency)?.label}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {frequencies.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FrequencyDetails frequency={frequency} draft={draft} onChange={set_draft} />
      </div>
      {frequency === 'custom' ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {custom_labels.map((label, index) => (
            <label
              className="space-y-1 text-xs text-muted-foreground"
              htmlFor={`custom-cron-${index}`}
              key={label}
            >
              <span>{label}</span>
              <Input
                id={`custom-cron-${index}`}
                className="h-9 rounded-xl font-mono text-foreground"
                value={custom_fields[index] ?? ''}
                onChange={(event) => update_custom_field(index, event.target.value)}
              />
            </label>
          ))}
          <p className="col-span-full text-xs text-muted-foreground">
            * means any value. Use 1,3 for a list, 1-5 for a range, or */2 for steps.
          </p>
          <p className="col-span-full text-xs text-muted-foreground">
            Weekdays use 0 for Sunday through 6 for Saturday. You can also use 7 for Sunday.
          </p>
          {!valid_custom_fields(custom_fields) ? (
            <p className="col-span-full text-xs text-destructive" role="alert">
              Enter a valid value in each schedule field.
            </p>
          ) : null}
        </div>
      ) : null}
      {frequency === 'interval' ? (
        <p className="text-xs text-muted-foreground">
          Intervals restart each hour, day, or month. They do not measure elapsed time.
        </p>
      ) : null}
    </div>
  );
}

function FrequencyDetails({
  frequency,
  draft,
  onChange,
}: {
  frequency: ScheduledTaskFrequency;
  draft: ScheduleDraft;
  onChange: (patch: Partial<ScheduleDraft>) => void;
}) {
  if (frequency === 'manual' || frequency === 'custom') return null;
  if (frequency === 'every_week') {
    return (
      <>
        <span className="text-muted-foreground">on</span>
        <WeekdaySelect
          value={draft.weekdays[0] ?? 1}
          onChange={(day) => onChange({ weekdays: [day] })}
        />
        <TimeFields draft={draft} onChange={onChange} />
      </>
    );
  }
  if (frequency === 'selected_days') {
    return (
      <>
        <WeekdayChips selected={draft.weekdays} onChange={(weekdays) => onChange({ weekdays })} />
        <TimeFields draft={draft} onChange={onChange} />
      </>
    );
  }
  if (frequency === 'every_month') {
    return (
      <>
        <span className="text-muted-foreground">on day</span>
        <NumberSelect
          label="Day of month"
          options={month_days}
          value={draft.day_of_month}
          onChange={(day_of_month) => onChange({ day_of_month })}
        />
        <TimeFields draft={draft} onChange={onChange} />
      </>
    );
  }
  if (frequency === 'run_once') {
    return (
      <>
        <span className="text-muted-foreground">on</span>
        <Input
          className="h-9 w-40 rounded-xl"
          aria-label="Run date"
          type="date"
          min={today_string()}
          value={draft.once_date}
          onChange={(event) => onChange({ once_date: event.target.value })}
        />
        <TimeFields draft={draft} onChange={onChange} />
      </>
    );
  }
  if (frequency === 'every_hour') {
    return (
      <>
        <span className="text-muted-foreground">at minute</span>
        <NumberSelect
          label="Minute"
          options={minutes}
          value={draft.minute}
          onChange={(minute) => onChange({ minute })}
        />
      </>
    );
  }
  if (frequency === 'interval') return <IntervalFields draft={draft} onChange={onChange} />;
  return <TimeFields draft={draft} onChange={onChange} />;
}

function IntervalFields({
  draft,
  onChange,
}: {
  draft: ScheduleDraft;
  onChange: (patch: Partial<ScheduleDraft>) => void;
}) {
  const max = interval_max(draft.interval_unit);
  return (
    <>
      <Input
        className="h-9 w-16 rounded-xl"
        aria-label="Interval count"
        type="number"
        min={1}
        max={max}
        value={draft.interval_value}
        onChange={(event) => onChange({ interval_value: Number(event.target.value) })}
      />
      <Select
        value={draft.interval_unit}
        onValueChange={(value) => {
          const interval_unit = value as ScheduleIntervalUnit;
          onChange({
            interval_unit,
            interval_value: Math.min(draft.interval_value, interval_max(interval_unit)),
          });
        }}
      >
        <SelectTrigger className="h-9 rounded-xl" aria-label="Interval unit">
          <SelectValue>
            {units.find((unit) => unit.value === draft.interval_unit)?.label}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {units.map((unit) => (
            <SelectItem key={unit.value} value={unit.value}>
              {unit.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {draft.interval_unit === 'hours' ? (
        <>
          <span className="text-muted-foreground">at minute</span>
          <NumberSelect
            label="Minute"
            options={minutes}
            value={draft.minute}
            onChange={(minute) => onChange({ minute })}
          />
        </>
      ) : null}
      {draft.interval_unit === 'days' ? <TimeFields draft={draft} onChange={onChange} /> : null}
    </>
  );
}

function TimeFields({
  draft,
  onChange,
}: {
  draft: ScheduleDraft;
  onChange: (patch: Partial<ScheduleDraft>) => void;
}) {
  return (
    <>
      <span className="text-muted-foreground">at</span>
      <div className="field flex h-9 items-center rounded-xl px-1 font-mono">
        <NumberSelect
          borderless
          label="Hour"
          options={hours}
          value={draft.hour}
          onChange={(hour) => onChange({ hour })}
        />
        <span aria-hidden="true">:</span>
        <NumberSelect
          borderless
          label="Minute"
          options={minutes}
          value={draft.minute}
          onChange={(minute) => onChange({ minute })}
        />
        <Clock3 className="mx-1 size-3.5 text-muted-foreground" aria-hidden="true" />
      </div>
    </>
  );
}

function WeekdaySelect({ value, onChange }: { value: Weekday; onChange: (day: Weekday) => void }) {
  return (
    <Select value={String(value)} onValueChange={(next) => onChange(Number(next) as Weekday)}>
      <SelectTrigger className="h-9 w-32 rounded-xl" aria-label="Weekday">
        <SelectValue>{weekday_order.find((day) => day.value === value)?.long}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {weekday_order.map((day) => (
          <SelectItem key={day.value} value={String(day.value)}>
            {day.long}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function WeekdayChips({
  selected,
  onChange,
}: {
  selected: Weekday[];
  onChange: (days: Weekday[]) => void;
}) {
  return (
    <fieldset className="flex flex-wrap gap-1">
      <legend className="sr-only">Selected weekdays</legend>
      {weekday_order.map((day) => {
        const active = selected.includes(day.value);
        return (
          <Button
            key={day.value}
            className={cn(
              'size-8 rounded-full p-0',
              active && 'bg-primary text-primary-foreground',
            )}
            type="button"
            size="icon-sm"
            variant={active ? 'default' : 'outline'}
            aria-label={day.long}
            aria-pressed={active}
            onClick={() =>
              onChange(
                active ? selected.filter((value) => value !== day.value) : [...selected, day.value],
              )
            }
          >
            {day.short[0]}
          </Button>
        );
      })}
    </fieldset>
  );
}

function NumberSelect({
  label,
  borderless = false,
  options,
  value,
  onChange,
}: {
  label: string;
  borderless?: boolean;
  options: number[];
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <Select value={String(value)} onValueChange={(next) => onChange(Number(next))}>
      <SelectTrigger
        className={cn(
          'h-9 w-16 rounded-xl font-mono',
          borderless && 'h-8 w-14 rounded-none border-0 bg-transparent px-1 shadow-none',
        )}
        aria-label={label}
      >
        <SelectValue>{String(value).padStart(2, '0')}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option} value={String(option)}>
            {String(option).padStart(2, '0')}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function frequency_to_draft(
  frequency: ScheduledTaskFrequency,
  draft: ScheduleDraft,
): ScheduleDraft | null {
  if (frequency === 'every_day') return { ...draft, frequency: 'daily' };
  if (frequency === 'every_weekday')
    return { ...draft, frequency: 'weekly', weekdays: [1, 2, 3, 4, 5] };
  if (frequency === 'every_week')
    return { ...draft, frequency: 'weekly', weekdays: [draft.weekdays[0] ?? 1] };
  if (frequency === 'selected_days')
    return {
      ...draft,
      frequency: 'weekly',
      weekdays: draft.weekdays.length ? draft.weekdays : [1],
    };
  if (frequency === 'every_month') return { ...draft, frequency: 'monthly' };
  if (frequency === 'every_hour') return { ...draft, frequency: 'hourly' };
  if (frequency === 'interval') return { ...draft, frequency: 'interval' };
  if (frequency === 'run_once') return { ...draft, frequency: 'once' };
  return null;
}

function custom_values(cron: string): string[] {
  const fields = cron.trim().split(/\s+/);
  return fields.length === 5 ? fields : ['*', '*', '*', '*', '*'];
}

function valid_custom_fields(fields: string[]) {
  return (
    fields.length === 5 &&
    fields.every((field) => field.length > 0 && !/\s/.test(field)) &&
    is_valid_cron(fields.join(' '))
  );
}

function interval_max(unit: ScheduleIntervalUnit) {
  return unit === 'minutes' ? 59 : unit === 'hours' ? 23 : 31;
}

function today_string() {
  const today = new Date();
  return new Date(today.getTime() - today.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}
