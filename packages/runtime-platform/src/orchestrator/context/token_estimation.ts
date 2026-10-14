import {
  estimate_context_tokens_roughly,
  estimate_model_visible_message_tokens,
} from '@coworker/shared';

export { estimate_context_tokens_roughly };

export function estimate_message_tokens(message: {
  message_content?: unknown;
  token_count?: number | null;
}) {
  if (message.message_content !== undefined) {
    return estimate_model_visible_message_tokens(message.message_content);
  }
  if (typeof message.token_count === 'number' && Number.isFinite(message.token_count)) {
    return message.token_count;
  }
  return estimate_context_tokens_roughly(message);
}
