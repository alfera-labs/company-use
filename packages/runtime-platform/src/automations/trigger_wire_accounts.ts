import type { Database } from '@coworker/core';
import { connections as connections_table } from '@coworker/core/db/schema';
import { read_connected_account_id } from '@runtime-platform/composio/composio_connect';
import type { TriggerRow } from '@runtime-platform/events/trigger_ingress';
import { and, eq, inArray } from 'drizzle-orm';

export type TriggerWireHealth = { is_dead: boolean; detail: string };

export type WiredTrigger = { trigger: TriggerRow; provisioning_key: string; connection_id: string };

export const healthy: TriggerWireHealth = { is_dead: false, detail: '' };

export const dead = (detail: string): TriggerWireHealth => ({ is_dead: true, detail });

export const missing_connection_detail = 'The connection behind this watcher is gone.';

export async function read_own_wire_health(
  db: Database,
  workspace_id: string,
  wired: WiredTrigger[],
): Promise<Map<string, TriggerWireHealth>> {
  const verdicts = new Map<string, TriggerWireHealth>();
  if (wired.length === 0) return verdicts;
  const rows = await db
    .select({
      connection_id: connections_table.connection_id,
      connection_status: connections_table.connection_status,
    })
    .from(connections_table)
    .where(
      and(
        eq(connections_table.workspace_id, workspace_id),
        inArray(
          connections_table.connection_id,
          wired.map((item) => item.connection_id),
        ),
      ),
    );
  const status_by_id = new Map(rows.map((row) => [row.connection_id, row.connection_status]));
  for (const item of wired) {
    const status = status_by_id.get(item.connection_id);
    if (status === undefined)
      verdicts.set(item.trigger.trigger_id, dead(missing_connection_detail));
    else if (status !== 'active')
      verdicts.set(item.trigger.trigger_id, dead(revoked_connection_detail));
    else verdicts.set(item.trigger.trigger_id, healthy);
  }
  return verdicts;
}
const revoked_connection_detail = 'The connection behind this watcher was revoked.';

export async function read_connected_accounts(
  db: Database,
  workspace_id: string,
  wired: WiredTrigger[],
): Promise<Map<string, string | { detail: string }>> {
  const connection_ids = [...new Set(wired.map((item) => item.connection_id))];
  const rows = await db
    .select()
    .from(connections_table)
    .where(
      and(
        eq(connections_table.workspace_id, workspace_id),
        inArray(connections_table.connection_id, connection_ids),
      ),
    );
  const accounts = new Map<string, string | { detail: string }>();
  for (const row of rows) {
    accounts.set(
      row.connection_id,
      read_connected_account_id(row) ?? { detail: revoked_connection_detail },
    );
  }
  return accounts;
}
