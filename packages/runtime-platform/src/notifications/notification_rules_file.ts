import type { Database } from '@coworker/core';
import { format_error_message } from '@coworker/shared';
import { content_version_for_bytes } from '@runtime-platform/files/workspace_file_content';
import {
  read_workspace_volume_file,
  resolve_workspace_volume_address,
} from '@runtime-platform/files/workspace_volume_browser';
import {
  has_frontmatter,
  read_body_under_frontmatter,
  read_frontmatter,
} from '@runtime-platform/notifications/frontmatter';
import {
  default_notification_rules,
  type NotificationRules,
  notification_rules_schema,
} from '@runtime-platform/notifications/notification_rules_schema';

export { read_body_under_frontmatter } from '@runtime-platform/notifications/frontmatter';
export {
  daily_summary_cadences,
  default_notification_rules,
  default_timezone,
  dial_levels,
  is_real_timezone,
  type NotificationRules,
  type NotificationRulesChanges,
  notification_rules_fields,
  notification_rules_schema,
  notifications_per_day_hard_ceiling,
  per_automation_notifications_hard_ceiling,
} from '@runtime-platform/notifications/notification_rules_schema';

export const notification_rules_file_name = 'notification-rules.md';
const default_policy_hash = 'default';

export type NotificationRulesRead = {
  policy: NotificationRules;
  policy_hash: string;
  file_text: string | null;
  parse_failed: boolean;
  read_failed: boolean;
  read_failed_reason?: string;
};

export type NotificationRulesReaders = {
  resolve_address?: typeof resolve_workspace_volume_address;
  read_file?: typeof read_workspace_volume_file;
};

const no_file_read: NotificationRulesRead = {
  policy: default_notification_rules,
  policy_hash: default_policy_hash,
  file_text: null,
  parse_failed: false,
  read_failed: false,
};

const policy_cache = new Map<string, { read: NotificationRulesRead; expires_time: number }>();
const policy_cache_ttl_ms = 60_000;

function cache_key(input: { workspace_id: string; agent_id: string }) {
  return `${input.workspace_id}:${input.agent_id}`;
}

export function forget_notification_rules_file(input: { workspace_id: string; agent_id: string }) {
  policy_cache.delete(cache_key(input));
}

// The bytes we just wrote, remembered as the answer. The volume is eventually consistent — a read
// straight after a successful write can still hand back the previous file for tens of seconds —
// and the writer knows exactly what it wrote, so nobody has to ask the volume to catch up.
export function remember_notification_rules_file(
  input: { workspace_id: string; agent_id: string },
  read: NotificationRulesRead,
  now: Date = new Date(),
) {
  policy_cache.set(cache_key(input), {
    read,
    expires_time: now.getTime() + policy_cache_ttl_ms,
  });
}

export async function read_notification_rules_file(
  db: Database,
  input: { workspace_id: string; agent_id: string },
  readers: NotificationRulesReaders = {},
  now: Date = new Date(),
): Promise<NotificationRulesRead> {
  const held = Object.keys(readers).length === 0;
  const key = cache_key(input);
  const hit = held ? policy_cache.get(key) : undefined;
  if (hit && hit.expires_time > now.getTime()) return hit.read;

  const read = await read_the_policy_file(db, input, readers);
  if (held && !read.read_failed) {
    policy_cache.set(key, { read, expires_time: now.getTime() + policy_cache_ttl_ms });
  }
  return read;
}

async function read_the_policy_file(
  db: Database,
  input: { workspace_id: string; agent_id: string },
  readers: NotificationRulesReaders,
): Promise<NotificationRulesRead> {
  const resolve_address = readers.resolve_address ?? resolve_workspace_volume_address;
  const read_file = readers.read_file ?? read_workspace_volume_file;
  try {
    const address = await resolve_address(db, input);
    if (!address) return no_file_read;

    const bytes = await read_missing_as_null(() =>
      read_file(address, notification_rules_file_name),
    );
    if (!bytes) return no_file_read;

    const file_text = new TextDecoder().decode(bytes);
    const parsed = parse_notification_rules_text(file_text);
    return {
      policy: parsed.policy,
      policy_hash: content_version_for_bytes(bytes),
      file_text,
      parse_failed: parsed.parse_failed,
      read_failed: false,
    };
  } catch (error) {
    return {
      ...no_file_read,
      read_failed: true,
      read_failed_reason: format_error_message(error),
    };
  }
}

export async function read_notification_rules_guidance(
  db: Database,
  input: { workspace_id: string; agent_id: string },
  readers: NotificationRulesReaders = {},
): Promise<string> {
  const read = await read_notification_rules_file(db, input, readers);
  if (!read.file_text) return '';
  return read_body_under_frontmatter(read.file_text).slice(0, max_guidance_characters);
}

const max_guidance_characters = 2_000;

export function parse_notification_rules_text(file_text: string): {
  policy: NotificationRules;
  parse_failed: boolean;
} {
  if (!has_frontmatter(file_text))
    return { policy: default_notification_rules, parse_failed: false };
  const parsed = notification_rules_schema.safeParse(read_frontmatter(file_text));
  if (parsed.success) return { policy: parsed.data, parse_failed: false };
  return { policy: default_notification_rules, parse_failed: true };
}

async function read_missing_as_null(read: () => Promise<Uint8Array>) {
  try {
    return await read();
  } catch (error) {
    if (is_missing_file_error(error)) return null;
    throw error;
  }
}

function is_missing_file_error(error: unknown) {
  const code = (error as { code?: string; status?: number } | null)?.code;
  const status = (error as { status?: number } | null)?.status;
  return status === 404 || code === 'workspace_file_not_found' || code === 'ENOENT';
}
