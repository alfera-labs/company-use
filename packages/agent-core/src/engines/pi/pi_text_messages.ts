import { get_pi_runtime_provider_name } from '@agent-core/engines/pi/pi_model';
import { create_progress_event } from '@agent-core/engines/pi/pi_progress_event';
import type { RuntimeAgentMessage } from '@agent-core/messages/runtime_message';
import type { RuntimeModelConfig } from '@agent-core/models/runtime_model_config';
import type { AgentEvent } from '@earendil-works/pi-agent-core';

export function streamed_text_to_runtime_message(
  text: string,
  model: RuntimeModelConfig,
): RuntimeAgentMessage | undefined {
  return text_message(text, model, { source: 'message_update_stream' });
}

export function tool_end_events(
  event: Extract<AgentEvent, { type: 'tool_execution_end' }>,
  model: RuntimeModelConfig,
) {
  const ended = create_progress_event('pi.tool_execution_end', undefined, {
    tool_call_id: event.toolCallId,
    tool_name: event.toolName,
    result: event.result,
    is_error: event.isError,
  });
  return [ended, ...tool_reply_events(event, model)];
}

function tool_reply_events(
  event: Extract<AgentEvent, { type: 'tool_execution_end' }>,
  model: RuntimeModelConfig,
) {
  if (event.isError) return [];
  const reply_text = (event.result?.details as { reply_text?: unknown } | undefined)?.reply_text;
  if (typeof reply_text !== 'string') return [];
  const message = text_message(reply_text, model, { source: 'reply_tool', stop_reason: 'stop' });
  return message ? [{ type: 'message' as const, message }] : [];
}

function text_message(
  text: string,
  model: RuntimeModelConfig,
  extra: Record<string, unknown>,
): RuntimeAgentMessage | undefined {
  const assistant_text = text.trim();
  if (!assistant_text) return undefined;

  return {
    role: 'assistant',
    content: [{ type: 'text', text: assistant_text }],
    metadata: {
      engine_name: 'pi',
      mode: 'provider',
      provider: get_pi_runtime_provider_name(model),
      model_provider: model.model_provider,
      model_proxy: model.model_proxy ?? model.model_provider,
      model: model.model_name,
      ...extra,
    },
  };
}
