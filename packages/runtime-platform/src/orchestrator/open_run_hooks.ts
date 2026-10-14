import { create_logger, format_error_message } from '@coworker/shared';
import { open_memory_run_hooks } from '@runtime-platform/memory_host/memory_run_hooks';
import { open_chat_scratch_run_hooks } from '@runtime-platform/orchestrator/chat_scratch_run_hooks';
import {
  empty_run_hooks,
  merge_run_hooks,
  type RunHookSourceInput,
  type RunHooks,
} from '@runtime-platform/orchestrator/run_hooks';

const log = create_logger('run_hooks');

type RunHookSource = {
  source_name: string;
  open(input: RunHookSourceInput): Promise<RunHooks>;
};

export const run_hook_sources: readonly RunHookSource[] = [
  { source_name: 'memory', open: open_memory_run_hooks },
  { source_name: 'chat_scratch_files', open: open_chat_scratch_run_hooks },
];

export async function open_run_hooks(
  input: RunHookSourceInput,
  extra_hooks: RunHooks | undefined,
  sources: readonly RunHookSource[] = run_hook_sources,
): Promise<RunHooks> {
  const opened = await Promise.all(sources.map((source) => open_hook_source(source, input)));
  return merge_run_hooks(extra_hooks ? [...opened, extra_hooks] : opened);
}

async function open_hook_source(source: RunHookSource, input: RunHookSourceInput) {
  try {
    return await source.open(input);
  } catch (error) {
    log.error('A run hook source could not open; the run continues without its hooks.', {
      source_name: source.source_name,
      workspace_id: input.workspace_id,
      run_id: input.run_id,
      error: format_error_message(error),
    });
    return empty_run_hooks;
  }
}
