import type { RuntimeToolExecutionContext } from '@runtime-platform/tools/types';

/**
 * The room facts a tool call made from inside another tool call keeps from its parent: who the
 * room is private to, and the run metadata that says who reads the files it writes.
 */
export function room_of_parent_call(
  context: Pick<RuntimeToolExecutionContext, 'room_private_to' | 'tool_context_metadata'>,
) {
  return {
    room_private_to: context.room_private_to,
    ...(context.tool_context_metadata
      ? { tool_context_metadata: context.tool_context_metadata }
      : {}),
  };
}
