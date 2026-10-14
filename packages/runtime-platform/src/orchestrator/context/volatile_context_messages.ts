import type { MessageContent } from '@coworker/shared';
import {
  format_current_connection_message,
  type SessionCurrentConnectionContext,
} from '@runtime-platform/orchestrator/context/current_connection_context';
import type { SessionCurrentTurnContext } from '@runtime-platform/orchestrator/context/current_turn_context';
import { format_current_turn_context_message } from '@runtime-platform/orchestrator/context/system_prompt_protocols';
import { keep_sections_this_run_can_use } from '@runtime-platform/orchestrator/context/system_prompt_sections';
import {
  document_library_tools,
  format_workspace_library_sync_message,
  type SessionWorkspaceLibraryContext,
} from '@runtime-platform/orchestrator/context/workspace_library_context';

export type ContextMessage = { run_message_id: string; role: string; content: MessageContent };

type VolatileContextInput = {
  workspace_library?: SessionWorkspaceLibraryContext;
  allowed_tool_names?: readonly string[];
  current_connection_context?: SessionCurrentConnectionContext;
  current_turn_context?: SessionCurrentTurnContext;
};

export function insert_volatile_context_messages(
  messages: ContextMessage[],
  input: VolatileContextInput,
): ContextMessage[] {
  return insert_context_messages_before_newest_user_message(
    messages,
    volatile_context_blocks(input),
  );
}

function volatile_context_blocks(input: VolatileContextInput) {
  return [
    {
      run_message_id: 'library-sync-state',
      text: library_sync_message_this_run_can_use(input),
    },
    {
      run_message_id: 'current-connections',
      text: format_current_connection_message(input.current_connection_context),
    },
    {
      run_message_id: 'current-turn-context',
      text: format_current_turn_context_message(input.current_turn_context),
    },
  ];
}

function library_sync_message_this_run_can_use(input: VolatileContextInput) {
  const text = format_workspace_library_sync_message(input.workspace_library);
  if (!text) return null;
  return keep_sections_this_run_can_use(
    [{ text, steers_tools: document_library_tools }],
    input.allowed_tool_names,
  )[0];
}

function insert_context_messages_before_newest_user_message(
  messages: ContextMessage[],
  blocks: { run_message_id: string; text: string | null | undefined }[],
): ContextMessage[] {
  const context_messages = blocks.flatMap((block) => {
    const text = block.text?.trim();
    if (!text) return [];
    return [
      {
        run_message_id: block.run_message_id,
        role: 'user',
        content: { type: 'text', text } as MessageContent,
      },
    ];
  });
  if (context_messages.length === 0) return messages;

  const newest = messages.at(-1);
  if (newest?.role !== 'user') return [...messages, ...context_messages];

  return [...messages.slice(0, -1), ...context_messages, newest];
}
