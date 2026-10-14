import type { Database } from '@coworker/core';
import { AppError, sleep } from '@coworker/shared';
import { content_version_for_bytes } from '@runtime-platform/files/workspace_file_content';
import {
  replace_workspace_volume_file,
  resolve_workspace_volume_address,
  write_workspace_volume_file,
} from '@runtime-platform/files/workspace_volume_browser';
import { build_default_ignore_rules } from '@runtime-platform/notifications/default_ignore_rules';
import {
  has_frontmatter,
  read_body_under_frontmatter,
  read_frontmatter,
} from '@runtime-platform/notifications/frontmatter';
import {
  forget_notification_rules_file,
  type NotificationRulesRead,
  notification_rules_file_name,
  read_notification_rules_file,
  remember_notification_rules_file,
} from '@runtime-platform/notifications/notification_rules_file';
import {
  default_timezone,
  is_real_timezone,
  type NotificationRules,
  type NotificationRulesChanges,
  notification_rules_schema,
  render_rule_line,
} from '@runtime-platform/notifications/notification_rules_schema';

export type SaveNotificationRulesInput = {
  workspace_id: string;
  agent_id: string;
  changes: NotificationRulesChanges;
  guidance?: string | undefined;
  changed_by: string;
  now?: Date;
};

export type NotificationRulesWriters = {
  resolve_address?: typeof resolve_workspace_volume_address;
  read_policy?: typeof read_notification_rules_file;
  write_file?: typeof write_workspace_volume_file;
  replace_file?: typeof replace_workspace_volume_file;
};

// The volume is a remote filesystem: a replace can lose a version race with another writer, or
// the provider can simply be unavailable for a second. Both are worth asking again — the read that
// decides the merge happens inside the attempt, so a retry merges over whatever is there NOW.
// Only a file the schema refuses is final: asking again would refuse it again.
// A run's sandbox holds a write delegation on the volume while it works and releases it when it
// unmounts, which is seconds, not minutes; the waits below add up to about five of them.
const write_attempts = 6;
const backoff_ms = 300;

export async function save_notification_rules_file(
  db: Database,
  input: SaveNotificationRulesInput,
  writers: NotificationRulesWriters = {},
) {
  const resolve_address = writers.resolve_address ?? resolve_workspace_volume_address;
  const address = await resolve_address(db, {
    workspace_id: input.workspace_id,
    agent_id: input.agent_id,
  });
  if (!address) {
    throw new AppError(
      'workspace_volume_unavailable',
      'This workspace has no files volume yet, so there is nowhere to keep notification-rules.md.',
      409,
    );
  }

  let last_error: unknown;
  for (let attempt = 1; attempt <= write_attempts; attempt++) {
    try {
      return await write_the_policy_file(db, input, writers, address);
    } catch (error) {
      if (error instanceof AppError && error.code === 'notification_rules_unreadable') throw error;
      last_error = error;
      if (attempt < write_attempts) await sleep(backoff_ms * attempt);
    }
  }
  throw last_error;
}

async function write_the_policy_file(
  db: Database,
  input: SaveNotificationRulesInput,
  writers: NotificationRulesWriters,
  address: Awaited<ReturnType<typeof resolve_workspace_volume_address>> & object,
) {
  const read_policy = writers.read_policy ?? read_notification_rules_file;
  forget_notification_rules_file(input);
  const current = await read_policy(db, input, writers);
  const named_changes = Object.fromEntries(
    Object.entries(input.changes).filter(([, value]) => value !== undefined),
  );
  const parsed = parse_over_current_file(current, named_changes);
  const policy =
    current.file_text === null
      ? await seed_a_new_file(db, input.workspace_id, parsed, named_changes)
      : parsed;
  const written_body =
    input.guidance ??
    (current.file_text
      ? read_body_under_frontmatter(current.file_text)
      : notification_rules_opening_words);
  const body = [written_body.trim(), audit_line(Object.keys(named_changes), input, policy)]
    .filter(Boolean)
    .join('\n');
  const file_text = render_notification_rules_file(policy, body);
  const data = new TextEncoder().encode(file_text);

  if (current.file_text === null) {
    await (writers.write_file ?? write_workspace_volume_file)(address, {
      file_path: notification_rules_file_name,
      data,
    });
  } else {
    await (writers.replace_file ?? replace_workspace_volume_file)(address, {
      file_path: notification_rules_file_name,
      data,
      expected_version: current.policy_hash,
      content_version: content_version_for_bytes(data),
    });
  }
  if (Object.keys(writers).length === 0) {
    remember_notification_rules_file(
      input,
      written_policy_read(policy, file_text, data),
      input.now ?? new Date(),
    );
  }
  return { policy, file_path: notification_rules_file_name };
}

function written_policy_read(
  policy: NotificationRules,
  file_text: string,
  data: Uint8Array,
): NotificationRulesRead {
  return {
    policy,
    policy_hash: content_version_for_bytes(data),
    file_text,
    parse_failed: false,
    read_failed: false,
  };
}

function parse_over_current_file(
  current: { policy: NotificationRules; file_text: string | null },
  named_changes: Record<string, unknown>,
): NotificationRules {
  const written =
    current.file_text && has_frontmatter(current.file_text)
      ? read_frontmatter(current.file_text)
      : current.policy;
  const parsed = notification_rules_schema.safeParse({ ...written, ...named_changes });
  if (parsed.success) return parsed.data;
  throw new AppError(
    'notification_rules_unreadable',
    `notification-rules.md has a setting nobody can read, so it cannot be patched: ${parsed.error.issues
      .map((issue) => `${issue.path.join('.')} ${issue.message}`)
      .join('; ')}`,
    422,
  );
}

async function seed_a_new_file(
  db: Database,
  workspace_id: string,
  policy: NotificationRules,
  named_changes: Record<string, unknown>,
): Promise<NotificationRules> {
  const with_zone =
    named_changes.quiet_hours === undefined
      ? await stamp_workspace_timezone(db, workspace_id, policy)
      : policy;
  if (named_changes.ignore !== undefined) return with_zone;
  return { ...with_zone, ignore: await build_default_ignore_rules(db, { workspace_id }) };
}

async function stamp_workspace_timezone(
  db: Database,
  workspace_id: string,
  policy: NotificationRules,
): Promise<NotificationRules> {
  const needs_stamp =
    !policy.timezone || (policy.quiet_hours && policy.quiet_hours.timezone === default_timezone);
  if (!needs_stamp) return policy;
  const timezone = await read_heartbeat_timezone(db, workspace_id);
  return {
    ...policy,
    timezone: policy.timezone ?? timezone,
    ...(policy.quiet_hours && policy.quiet_hours.timezone === default_timezone
      ? { quiet_hours: { ...policy.quiet_hours, timezone } }
      : {}),
  };
}

async function read_heartbeat_timezone(db: Database, workspace_id: string): Promise<string> {
  const rows = await db.query.triggers.findMany({
    where: (table, { and, eq }) =>
      and(eq(table.workspace_id, workspace_id), eq(table.trigger_type, 'schedule')),
  });
  const heartbeat = rows.find(
    (row) => row.trigger_config?.provisioning_key === 'workspace_heartbeat_v1',
  );
  const timezone = heartbeat?.trigger_config?.timezone;
  return typeof timezone === 'string' && is_real_timezone(timezone) ? timezone : default_timezone;
}

const notification_rules_opening_words = [
  '# Notification rules',
  '',
  'How much you want to be interrupted. Edit the settings above, or ask for the change in chat.',
  '',
  '## Changes',
].join('\n');

function audit_line(
  changed_keys: string[],
  input: SaveNotificationRulesInput,
  policy: NotificationRules,
) {
  const when = (input.now ?? new Date()).toISOString().slice(0, 10);
  const what = changed_keys.join(', ') || (input.guidance === undefined ? 'nothing' : 'the prose');
  return `- ${when}: ${what} changed by ${input.changed_by} (the dial is now ${policy.dial}, ${policy.max_notifications_per_day} interruptions a day)`;
}

function render_notification_rules_file(policy: NotificationRules, body: string): string {
  const lines = [
    '---',
    `dial: ${policy.dial}`,
    ...(policy.timezone ? [`timezone: ${policy.timezone}`] : []),
    `quiet_hours: ${render_quiet_hours(policy)}`,
    `max_notifications_per_day: ${policy.max_notifications_per_day}`,
    `daily_summary: ${policy.daily_summary_cadence} ${policy.daily_summary_at_time} -> ${policy.daily_summary_channel}`,
    `delivery_channel_order: [${policy.delivery_channel_order.join(', ')}]`,
    `always_notify: [${policy.always_notify.join(', ')}]`,
    `never_notify: [${policy.never_notify.join(', ')}]`,
    `own_daily_limit: { ${Object.entries(policy.own_daily_limit)
      .map(([automation, cap]) => `${automation}: ${cap}`)
      .join(', ')} }`,
    `ignore: [${policy.ignore.map(render_rule_line).join(', ')}]`,
    `triage_calls_per_day: ${policy.triage_calls_per_day}`,
    '---',
    '',
  ];
  return `${lines.join('\n')}${body ? `${body}\n` : ''}`;
}

function render_quiet_hours(policy: NotificationRules) {
  const quiet = policy.quiet_hours;
  if (!quiet) return 'null';
  return `${quiet.start}-${quiet.end} ${quiet.timezone}`;
}
