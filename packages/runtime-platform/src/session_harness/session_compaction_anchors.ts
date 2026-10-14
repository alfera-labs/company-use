import {
  message_content_to_runtime_parts,
  runtime_message_parts_text,
} from '@runtime-platform/orchestrator/runtime_message_content';
import type { HarnessRunMessage } from '@runtime-platform/session_harness/session_entries';

export function preserve_compaction_anchors(
  summary: string,
  messages: readonly HarnessRunMessage[],
) {
  const anchors = preserved_session_anchors(messages);
  if (!anchors || summary.includes('## Preserved Session Anchors')) return summary;

  return [summary.trim(), '', '## Preserved Session Anchors', anchors].join('\n');
}

function preserved_session_anchors(messages: readonly HarnessRunMessage[]) {
  const first_user_message = messages.find(
    (message) => message.message_role === 'user' && message.is_model_visible !== false,
  );
  if (!first_user_message) return '';

  const text = anchor_message_text(first_user_message);
  if (!text) return '';

  return [
    `- First user message id: ${first_user_message.run_message_id}`,
    '```text',
    text,
    '```',
  ].join('\n');
}

function anchor_message_text(message: HarnessRunMessage) {
  const text = runtime_message_parts_text(
    message_content_to_runtime_parts(message.message_content),
  );
  if (text.length <= 4000) return text;

  return `${text.slice(0, 4000)}\n[truncated ${text.length - 4000} chars]`;
}
