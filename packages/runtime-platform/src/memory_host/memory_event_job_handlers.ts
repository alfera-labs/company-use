import type { EventJobHandler } from '@coworker/jobs';
import { not_in_this_edition_code } from '@coworker/memory/not_in_this_edition';

function finish_memory_job_as_skipped(job_handler: string): EventJobHandler {
  return {
    job_handler,
    run: async () => ({ job_status: 'done', result_data: { skipped: not_in_this_edition_code } }),
  };
}

export const brain_source_crawl_job = finish_memory_job_as_skipped('brain_source_crawl');
export const brain_chunk_embedding_job = finish_memory_job_as_skipped('brain_chunk_embedding');
export const memory_save_retry_job = finish_memory_job_as_skipped('memory_save_retry');
export const memory_conversation_day_job = finish_memory_job_as_skipped('memory_conversation_day');
export const memory_scope_consolidation_job = finish_memory_job_as_skipped(
  'memory_scope_consolidation',
);
