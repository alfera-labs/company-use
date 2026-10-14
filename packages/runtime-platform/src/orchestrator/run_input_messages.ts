import type { RuntimeAgentMessagePart } from '@agent-core/messages/runtime_message';
import type { CreateRunMessageInput } from '@coworker/core/db/queries/sessions';
import type { MessageContent } from '@coworker/shared';
import { runtime_parts_to_message_content } from '@runtime-platform/orchestrator/runtime_message_content';
import type {
  StartAgentRunInput,
  StartAgentRunPriorMessage,
} from '@runtime-platform/orchestrator/runtime_orchestrator';

type RunInputMessagesInput = Pick<
  StartAgentRunInput,
  | 'workspace_id'
  | 'session_id'
  | 'prior_messages'
  | 'source_type'
  | 'user_message_source_metadata'
  | 'user_message_is_user_visible'
  | 'actor_id'
>;

/**
 * The model reads the parts of a stored message and the chat shows its text. A note for the
 * model is stored as a part after the person's own, so the text stays what the person sent.
 */
export function build_run_input_messages(
  input: RunInputMessagesInput,
  run_id: string,
  user_content: RuntimeAgentMessagePart[],
  notes_for_the_model: RuntimeAgentMessagePart[] = [],
): CreateRunMessageInput[] {
  return [
    ...(input.prior_messages ?? []).map((prior_message) =>
      build_prior_message(input, run_id, prior_message),
    ),
    ...(user_content.length === 0
      ? []
      : [build_user_message(input, run_id, user_content, notes_for_the_model)]),
  ];
}

function build_user_message_content(
  user_content: RuntimeAgentMessagePart[],
  notes_for_the_model: RuntimeAgentMessagePart[],
): MessageContent {
  const content = runtime_parts_to_message_content(user_content);
  const note_parts = runtime_parts_to_message_content(notes_for_the_model).parts ?? [];
  if (note_parts.length === 0) return content;
  return { ...content, parts: [...(content.parts ?? []), ...note_parts] };
}

function build_prior_message(
  input: RunInputMessagesInput,
  run_id: string,
  prior_message: StartAgentRunPriorMessage,
): CreateRunMessageInput {
  return {
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    run_id,
    message_role: prior_message.message_role,
    message_content: runtime_parts_to_message_content(prior_message.message_content),
    source_type: prior_message.source_type ?? input.source_type ?? 'runtime',
    ...(prior_message.source_metadata === undefined
      ? {}
      : { source_metadata: prior_message.source_metadata }),
    ...(prior_message.is_user_visible === undefined
      ? {}
      : { is_user_visible: prior_message.is_user_visible }),
    actor_id: input.actor_id,
  };
}

function build_user_message(
  input: RunInputMessagesInput,
  run_id: string,
  user_content: RuntimeAgentMessagePart[],
  notes_for_the_model: RuntimeAgentMessagePart[],
): CreateRunMessageInput {
  return {
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    run_id,
    message_role: 'user' as const,
    message_content: build_user_message_content(user_content, notes_for_the_model),
    source_type: input.source_type ?? 'dashboard',
    ...(input.user_message_source_metadata === undefined
      ? {}
      : { source_metadata: input.user_message_source_metadata }),
    ...(input.user_message_is_user_visible === undefined
      ? {}
      : { is_user_visible: input.user_message_is_user_visible }),
    actor_id: input.actor_id,
  };
}
