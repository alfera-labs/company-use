import { brain_sources, event_jobs } from '@coworker/core/db/schema';
import { and, ne, sql } from 'drizzle-orm';

const sync_cadence_interval = sql`CASE ${brain_sources.sync_cadence}
  WHEN 'hourly' THEN interval '1 hour'
  WHEN 'weekly' THEN interval '7 days'
  ELSE interval '1 day'
END`;

const last_crawl_request_time = sql`(select max(${event_jobs.created_time}) from ${event_jobs}
  where ${event_jobs.workspace_id} = ${brain_sources.workspace_id}
    and ${event_jobs.queue_key} = 'brain_source_crawl:' || ${brain_sources.brain_source_id})`;

// A fixed one-day wait for a broken source; count failures for an exponential backoff
// when a daily retry of a dead connection costs too much.
const crawl_retry_wait = sql`CASE ${brain_sources.sync_status}
  WHEN 'broken' THEN interval '1 day'
  ELSE interval '1 hour'
END`;

/**
 * A source syncs again one cadence after its last good sync, and never sooner than the retry wait
 * after its last crawl request. The crawl request is the lease: a crawl that died mid-sync leaves
 * the source in any status, even 'syncing', and the next request goes out when the wait ends.
 * A source that keeps failing is retried hourly, a broken source daily, never every tick.
 * NULL means the source never synced and was never requested: it is due now.
 */
export const brain_source_next_sync_time = sql<Date | null>`greatest(
  ${brain_sources.last_synced_time} + (${sync_cadence_interval}),
  ${last_crawl_request_time} + (${crawl_retry_wait})
)`;

export const is_member_brain_source = sql`coalesce((${brain_sources.metadata}->>'system_source')::boolean, false) = false`;

export const brain_source_syncs_on_schedule = and(
  ne(brain_sources.sync_status, 'paused'),
  ne(brain_sources.app_key, 'alfera_notes'),
  ne(brain_sources.sync_cadence, 'manual'),
  is_member_brain_source,
);
