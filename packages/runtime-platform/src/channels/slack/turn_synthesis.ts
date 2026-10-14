import { create_llm_gateway, type LlmGateway } from '@agent-core/llm_gateway';
import type { FileMetadataData } from '@coworker/core/db/schema/json_column_types';
import type {
  SlackTurnRecoveryMessage,
  SlackTurnResolutionToolCall,
} from '@runtime-platform/channels/slack/turn_resolution';

export type SlackTurnSynthesisArtifact = {
  file_id: string;
  file_purpose: string;
  file_status: string;
  storage_provider: string;
  storage_key: string;
  file_name: string | null;
  content_preview: string | null;
  file_metadata: FileMetadataData;
};

export type SlackTurnSynthesisInput = {
  workspace_id: string;
  run_id: string;
  run_messages: SlackTurnRecoveryMessage[];
  tool_calls: SlackTurnResolutionToolCall[];
  files: SlackTurnSynthesisArtifact[];
};

const final_synthesis_instructions = `Write the final Slack response for a completed agent run that ended after tool activity without publishing its closing answer.
Use only the persisted evidence below. Do not claim work the evidence does not prove. Include verified links and clearly state any missing result. Return only the user-facing response.`;

const evidence_limit = 30_000;

export async function synthesize_slack_turn_reply(
  input: SlackTurnSynthesisInput,
  gateway: LlmGateway = create_llm_gateway(),
) {
  const result = await gateway.generate_text({
    use_case: 'session_summary',
    workspace_id: input.workspace_id,
    run_id: input.run_id,
    system_prompt: final_synthesis_instructions,
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: build_synthesis_evidence(input) }],
      },
    ],
    tools: [],
    metadata: { source: 'slack_turn_final_synthesis' },
  });
  return result.text.trim() || null;
}

function build_synthesis_evidence(input: SlackTurnSynthesisInput) {
  const messages = input.run_messages
    .filter((message) => !is_slack_history_backfill(message.source_metadata))
    .slice(-10)
    .map((message) => ({
      role: message.message_role,
      kind: message.message_kind,
      text: truncate_text(message.content_text, 2_000),
    }));
  const tool_calls = input.tool_calls.slice(-16).map((tool_call) => ({
    tool_name: tool_call.tool_name,
    tool_status: tool_call.tool_status,
    input: compact_json(tool_call.input_data, 1_000),
    output: compact_json(tool_call.output_data, 3_000),
    error: truncate_text(tool_call.error_message, 1_000),
  }));
  const files = input.files.slice(-10).map((artifact) => ({
    file_id: artifact.file_id,
    file_purpose: artifact.file_purpose,
    file_status: artifact.file_status,
    storage_provider: artifact.storage_provider,
    storage_key: truncate_text(artifact.storage_key, 1_000),
    file_name: artifact.file_name,
    content_preview: truncate_text(artifact.content_preview, 2_000),
    external_url: artifact.file_metadata.external_url ?? null,
  }));
  return JSON.stringify({ messages, tool_calls, files }).slice(0, evidence_limit);
}

function is_slack_history_backfill(source_metadata: SlackTurnRecoveryMessage['source_metadata']) {
  return source_metadata?.slack?.history_backfill === true;
}

function compact_json(value: unknown, limit: number) {
  try {
    return truncate_text(JSON.stringify(value), limit);
  } catch {
    return '[unserializable]';
  }
}

function truncate_text(value: string | null | undefined, limit: number) {
  if (!value || value.length <= limit) return value ?? null;
  return `${value.slice(0, limit)}...`;
}
