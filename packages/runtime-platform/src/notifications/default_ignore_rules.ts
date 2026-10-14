import type { Database } from '@coworker/core';
import { list_connections } from '@coworker/core/db/queries/sessions';
import { list_workspace_member_users } from '@coworker/core/db/queries/workspace_membership';
import type { TriggerRule } from '@coworker/core/db/schema/json_column_types';
import { has_frontmatter, read_frontmatter } from '@runtime-platform/notifications/frontmatter';
import {
  type NotificationRulesReaders,
  read_notification_rules_file,
} from '@runtime-platform/notifications/notification_rules_file';

export async function build_default_ignore_rules(
  db: Database,
  input: { workspace_id: string },
): Promise<TriggerRule[]> {
  const own_addresses = await read_own_addresses(db, input.workspace_id);
  return [
    ...(own_addresses.length > 0
      ? [{ field: 'sender', operation: 'address_is_not_any_of' as const, values: own_addresses }]
      : []),
    { field: 'payload.headers', operation: 'header_missing', values: ['List-Unsubscribe'] },
    { field: 'sender', operation: 'does_not_contain_any_of', values: ['no-reply', 'noreply'] },
  ];
}

export async function read_ignore_rules(
  db: Database,
  input: { workspace_id: string; agent_id: string },
  readers: NotificationRulesReaders = {},
): Promise<TriggerRule[]> {
  const read = await read_notification_rules_file(db, input, readers);
  if (
    read.file_text &&
    has_frontmatter(read.file_text) &&
    'ignore' in read_frontmatter(read.file_text)
  ) {
    return read.policy.ignore;
  }
  return build_default_ignore_rules(db, { workspace_id: input.workspace_id });
}

async function read_own_addresses(db: Database, workspace_id: string): Promise<string[]> {
  const connections = await list_connections(db, workspace_id);
  const connected = connections
    .flatMap((connection) => [connection.external_account_name, connection.external_account_id])
    .filter((value): value is string => Boolean(value?.includes('@')));
  if (connected.length > 0) return unique_addresses(connected);

  const members = await list_workspace_member_users(db, workspace_id);
  return unique_addresses(members.map((member) => member.email));
}

function unique_addresses(addresses: string[]): string[] {
  return [...new Set(addresses.map((address) => address.trim().toLowerCase()))];
}
