import type { NotificationRules } from '@runtime-platform/notifications/notification_rules_file';

export function automation_is_listed(
  list: string[],
  input: { automation_id: string | null; automation_name?: string | null | undefined },
) {
  const names = [input.automation_id ?? '', input.automation_name ?? ''].map(as_automation_key);
  return list.some((entry) => entry.trim() !== '' && names.includes(as_automation_key(entry)));
}

export function read_own_daily_limit(
  policy: NotificationRules,
  input: { automation_id: string | null; automation_name?: string | null | undefined },
): number | null {
  const own_limit = Object.entries(policy.own_daily_limit).find(([automation]) =>
    automation_is_listed([automation], input),
  );
  return own_limit ? own_limit[1] : null;
}

function as_automation_key(value: string) {
  return value.trim().toLowerCase().replace(/\s+/gu, '-');
}
