import type { Database } from '@coworker/core';

export async function enqueue_stale_brain_source_crawls(_db: Database) {
  return { stale_count: 0, enqueued_count: 0 };
}
