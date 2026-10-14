import { find_event_job_handler } from '@runtime-platform/events/event_job_handler_registry';
import { start_memory_prompt_text } from '@runtime-platform/memory_host/memory_prompt_section';
import { open_memory_run } from '@runtime-platform/memory_host/memory_run';
import { open_memory_run_hooks } from '@runtime-platform/memory_host/memory_run_hooks';
import { empty_run_hooks } from '@runtime-platform/orchestrator/run_hooks';
import { company_memory_tools } from '@runtime-platform/tools/definitions/company_memory_tools';
import { get_all_tools } from '@runtime-platform/tools/tool_registry';
import { describe, expect, it } from 'vitest';

const memory_job_handlers = [
  'brain_source_crawl',
  'brain_chunk_embedding',
  'memory_save_retry',
  'memory_conversation_day',
  'memory_scope_consolidation',
];
const memory_tool_names = [
  'runtime-search_documents-1',
  'runtime-read_document-1',
  'runtime-download_document_original-1',
  'runtime-sync_into_memory-1',
];
const no_run = {} as Parameters<typeof open_memory_run_hooks>[0];
const no_job = {} as Parameters<NonNullable<ReturnType<typeof find_event_job_handler>>['run']>[0];

describe('company memory stand-ins in the runtime', () => {
  it('registers no memory tool', () => {
    const tool_names = get_all_tools().map((tool) => tool.node_key);

    expect(company_memory_tools).toEqual([]);
    for (const tool_name of memory_tool_names) expect(tool_names).not.toContain(tool_name);
  });

  it('opens a run with no memory, no memory hooks and no memory prompt text', async () => {
    expect(await open_memory_run(no_run)).toBeNull();
    expect(await open_memory_run_hooks(no_run)).toBe(empty_run_hooks);
    expect(await start_memory_prompt_text(no_run).wait_within_budget()).toBeNull();
  });

  it.each(memory_job_handlers)('finishes a %s job as skipped', async (job_handler) => {
    const handler = find_event_job_handler(job_handler);

    expect(await handler?.run(no_job)).toEqual({
      job_status: 'done',
      result_data: { skipped: 'not_in_this_edition' },
    });
  });
});
