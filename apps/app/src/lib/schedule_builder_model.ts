type ScheduleFrequency = 'once' | 'interval' | 'hourly' | 'daily' | 'weekly' | 'monthly';
export type ScheduleIntervalUnit = 'minutes' | 'hours' | 'days';

// 0 = Sunday … 6 = Saturday (cron's day-of-week numbering).
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type ScheduleDraft = {
  frequency: ScheduleFrequency;
  minute: number;
  hour: number;
  interval_value: number;
  interval_unit: ScheduleIntervalUnit;
  weekdays: Weekday[];
  day_of_month: number;
  once_date: string;
};

export const weekday_order: ReadonlyArray<{ value: Weekday; short: string; long: string }> = [
  { value: 1, short: 'Mon', long: 'Monday' },
  { value: 2, short: 'Tue', long: 'Tuesday' },
  { value: 3, short: 'Wed', long: 'Wednesday' },
  { value: 4, short: 'Thu', long: 'Thursday' },
  { value: 5, short: 'Fri', long: 'Friday' },
  { value: 6, short: 'Sat', long: 'Saturday' },
  { value: 0, short: 'Sun', long: 'Sunday' },
];

export const default_schedule_draft: ScheduleDraft = {
  frequency: 'daily',
  minute: 0,
  hour: 9,
  interval_value: 15,
  interval_unit: 'minutes',
  weekdays: [1, 2, 3, 4, 5],
  day_of_month: 1,
  once_date: '',
};

export function draft_to_run_once_at(draft: ScheduleDraft): string | null {
  if (draft.frequency !== 'once') return null;
  const parts = parse_iso_date(draft.once_date);
  if (!parts) return null;
  const at = new Date(parts.year, parts.month - 1, parts.day, draft.hour, draft.minute, 0, 0);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

export function draft_to_cron(draft: ScheduleDraft): string | null {
  switch (draft.frequency) {
    case 'once': {
      const parts = parse_iso_date(draft.once_date);
      if (!parts) return null;
      return `${draft.minute} ${draft.hour} ${parts.day} ${parts.month} *`;
    }
    case 'interval':
      return interval_to_cron(draft);
    case 'hourly':
      return `${draft.minute} * * * *`;
    case 'daily':
      return `${draft.minute} ${draft.hour} * * *`;
    case 'weekly': {
      if (draft.weekdays.length === 0) return null;
      const days = [...draft.weekdays].sort((a, b) => a - b).join(',');
      return `${draft.minute} ${draft.hour} * * ${days}`;
    }
    case 'monthly':
      return `${draft.minute} ${draft.hour} ${draft.day_of_month} * *`;
    default:
      return null;
  }
}

function interval_to_cron(draft: ScheduleDraft): string | null {
  const value = draft.interval_value;
  if (!Number.isInteger(value) || value < 1) return null;

  switch (draft.interval_unit) {
    case 'minutes':
      return value <= 59 ? `*/${value} * * * *` : null;
    case 'hours':
      return value <= 23 ? `${draft.minute} */${value} * * *` : null;
    case 'days':
      return value <= 31 ? `${draft.minute} ${draft.hour} */${value} * *` : null;
    default:
      return null;
  }
}

function parse_iso_date(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

export function cron_to_draft(cron: string): ScheduleDraft | null {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [minute_field, hour_field, dom_field, month_field, dow_field] = fields;
  if (month_field !== '*') return null;

  if (hour_field === '*' && dom_field === '*' && dow_field === '*') {
    const interval_value = step_value(minute_field, 59);
    if (interval_value !== null) {
      return {
        ...default_schedule_draft,
        frequency: 'interval',
        interval_unit: 'minutes',
        interval_value,
      };
    }
  }

  const minute = whole_number(minute_field);
  if (minute === null) return null;

  if (hour_field === '*' && dom_field === '*' && dow_field === '*') {
    return { ...default_schedule_draft, frequency: 'hourly', minute };
  }

  if (dom_field === '*' && dow_field === '*') {
    const interval_value = step_value(hour_field, 23);
    if (interval_value !== null) {
      return {
        ...default_schedule_draft,
        frequency: 'interval',
        interval_unit: 'hours',
        interval_value,
        minute,
      };
    }
  }

  const hour = whole_number(hour_field);
  if (hour === null) return null;

  if (dow_field === '*') {
    const interval_value = step_value(dom_field, 31);
    if (interval_value !== null) {
      return {
        ...default_schedule_draft,
        frequency: 'interval',
        interval_unit: 'days',
        interval_value,
        minute,
        hour,
      };
    }
  }

  if (dom_field === '*' && dow_field === '*') {
    return { ...default_schedule_draft, frequency: 'daily', minute, hour };
  }
  if (dow_field === '*' && dom_field !== '*') {
    const day_of_month = whole_number(dom_field);
    if (day_of_month === null) return null;
    return { ...default_schedule_draft, frequency: 'monthly', minute, hour, day_of_month };
  }
  if (dom_field === '*' && dow_field !== '*') {
    const weekdays = parse_weekdays(dow_field);
    if (!weekdays) return null;
    return { ...default_schedule_draft, frequency: 'weekly', minute, hour, weekdays };
  }
  return null;
}

function parse_weekdays(field: string | undefined): Weekday[] | null {
  if (!field) return null;
  const values: Weekday[] = [];
  for (const token of field.split(',')) {
    const value = whole_number(token);
    if (value === null || value < 0 || value > 6) return null;
    values.push(value as Weekday);
  }
  return values;
}

function whole_number(token: string | undefined): number | null {
  if (token === undefined || !/^\d+$/.test(token)) return null;
  return Number(token);
}

function step_value(token: string | undefined, max: number): number | null {
  const match = /^\*\/(\d+)$/.exec(token ?? '');
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isInteger(value) && value > 0 && value <= max ? value : null;
}
