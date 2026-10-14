import {
  type ChatScratchOwner,
  restore_chat_scratch_files,
} from '@runtime-platform/files/chat_scratch_files';
import {
  empty_run_hooks,
  type PrepareEnvironmentHook,
  type RunHookSourceInput,
  type RunHooks,
} from '@runtime-platform/orchestrator/run_hooks';

const restore_timeout_ms = 60_000;

/** Puts this chat's recent scratch files back before its first tool call in a new sandbox. */
export function restore_chat_scratch_files_hook(owner: ChatScratchOwner): PrepareEnvironmentHook {
  return {
    hook_name: 'restore_chat_scratch_files',
    timeout_ms: restore_timeout_ms,
    on_failure: 'continue_run',
    run: async (workspace) => {
      await restore_chat_scratch_files(owner, workspace.environment);
      return { outcome: 'prepared' };
    },
  };
}

export async function open_chat_scratch_run_hooks(input: RunHookSourceInput): Promise<RunHooks> {
  return {
    ...empty_run_hooks,
    prepare: [
      restore_chat_scratch_files_hook({
        workspace_id: input.workspace_id,
        session_id: input.session_id,
      }),
    ],
  };
}
