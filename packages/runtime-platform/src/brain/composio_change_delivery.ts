import type { Database } from '@coworker/core/db/connection';

export async function queue_debounced_crawl_for_composio_change_delivery(
  _db: Database,
  _input: { connected_account_id: string; actor_id: string; now?: Date },
) {
  return { sources_matched: 0, enqueued_count: 0 };
}
