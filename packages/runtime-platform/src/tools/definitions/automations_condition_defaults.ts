import type { Database } from '@coworker/core';
import { get_tool_catalog_entry } from '@coworker/core/db/queries/catalog';
import type { TriggerRule } from '@coworker/core/db/schema/json_column_types';
import { read_ignore_rules } from '@runtime-platform/notifications/default_ignore_rules';

const email_trigger_slug_prefixes = ['GMAIL_', 'OUTLOOK_'];

export async function default_email_conditions(
  db: Database,
  input: { workspace_id: string; agent_id: string; node_keys: string[] },
): Promise<TriggerRule[]> {
  const listens_to_mail = await any_ear_is_a_mailbox(db, input);
  if (!listens_to_mail) return [];
  return read_ignore_rules(db, { workspace_id: input.workspace_id, agent_id: input.agent_id });
}

async function any_ear_is_a_mailbox(
  db: Database,
  input: { workspace_id: string; node_keys: string[] },
): Promise<boolean> {
  for (const node_key of input.node_keys) {
    const node = await get_tool_catalog_entry(db, { workspace_id: input.workspace_id, node_key });
    const slug = node?.node_config.composio?.trigger_slug?.toUpperCase() ?? '';
    if (email_trigger_slug_prefixes.some((prefix) => slug.startsWith(prefix))) return true;
  }
  return false;
}
