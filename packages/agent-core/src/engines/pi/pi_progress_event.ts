import type { RuntimeAgentEngineEvent } from '@agent-core/runs/agent_run';

/** Builds one engine progress event, keeping only the fields that carry a value. */
export function create_progress_event(
  label: string,
  fields?: { delta?: string; content?: unknown; content_index?: number },
  metadata?: Record<string, unknown>,
): RuntimeAgentEngineEvent {
  return {
    type: 'progress',
    label,
    ...(fields?.delta === undefined ? {} : { delta: fields.delta }),
    ...(fields?.content === undefined ? {} : { content: fields.content }),
    ...(fields?.content_index === undefined ? {} : { content_index: fields.content_index }),
    ...(metadata === undefined ? {} : { metadata }),
  };
}
