import {
  type RunAudience,
  read_tool_call_audience,
} from '@runtime-platform/orchestrator/run_audience';

/** Inside tmp/, the sandbox's own disk: no other chat mounts it, and it goes with the sandbox. */
export const private_tool_output_folder = 'tmp/tool-output';

const tool_output_folder_by_audience: Readonly<Record<RunAudience, string>> = {
  workspace: 'system/tool-output',
  narrow: private_tool_output_folder,
};

/**
 * Where a tool result too big to show in full is saved. A run narrower than the workspace saves
 * it to sandbox scratch, because every chat in the workspace can read the shared volume.
 */
export function tool_output_path(
  tool_context: { run_key: string; metadata?: Readonly<Record<string, unknown>> | undefined },
  file_name: string,
) {
  const run_audience = read_tool_call_audience(tool_context.metadata, tool_context.run_key);
  return `${tool_output_folder_by_audience[run_audience]}/${file_name}`;
}
