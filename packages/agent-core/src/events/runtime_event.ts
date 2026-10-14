import type { RuntimeAgentMessage } from '@agent-core/messages/runtime_message';
import type { RuntimeModelConfig } from '@agent-core/models/runtime_model_config';
import type { AgentRunResult } from '@agent-core/runs/agent_run';

type RuntimeRunEventType = 'start' | 'message' | 'message_delta' | 'progress' | 'error' | 'end';

export type RuntimeRunEventCommon = {
  event_id: string;
  event_sequence: number;
  run_key: string;
  session_key?: string;
};

type RuntimeRunEventBase = RuntimeRunEventCommon & {
  event_type: RuntimeRunEventType;
};

export type RuntimeRunEventMetadata = Record<string, unknown> & {
  renderer_key?: string;
  ui_spec_format?: string;
  tool_call_id?: string;
  source_tool_call_id?: string;
  tool_name?: string;
  runtime_tool_name?: string;
  provider_tool_name?: string;
  runtime_tool_call_id?: string;
  model_tool_call_id?: string;
  model_proxy?: string;
  provider?: string;
  model?: string;
  file_id?: string;
  id?: string;
  document_id?: string;
  file_purpose?: string;
  kind?: string;
  title?: string;
  artifact_title?: string;
  content?: string;
  content_preview?: string;
  content_delta?: string;
  delta?: string;
  text_delta?: string;
  code_delta?: string;
  data?: string;
  text?: string;
  code?: string;
  is_error?: boolean;
  args?: unknown;
  result?: unknown;
  partial_result?: unknown;
  ui_spec?: unknown;
  spec?: unknown;
  ui_spec_delta?: unknown;
  spec_delta?: unknown;
};

type RuntimeRunStartEvent = RuntimeRunEventBase & {
  event_type: 'start';
  model: RuntimeModelConfig;
  message_count: number;
  tool_count: number;
  metadata?: RuntimeRunEventMetadata;
};

type RuntimeRunMessageEvent = RuntimeRunEventBase & {
  event_type: 'message';
  message: RuntimeAgentMessage;
};

type RuntimeRunMessageDeltaEvent = RuntimeRunEventBase & {
  event_type: 'message_delta';
  delta: string;
  accumulated_text: string;
  content_index?: number;
  metadata?: RuntimeRunEventMetadata;
};

export type RuntimeRunProgressEvent = RuntimeRunEventBase & {
  event_type: 'progress';
  label: string;
  delta?: string;
  content?: unknown;
  content_index?: number;
  metadata?: RuntimeRunEventMetadata;
};

type RuntimeRunErrorEvent = RuntimeRunEventBase & {
  event_type: 'error';
  error: {
    code: string;
    message: string;
  };
};

type RuntimeRunEndEvent = RuntimeRunEventBase & {
  event_type: 'end';
  result: AgentRunResult;
};

export type RuntimeRunEvent =
  | RuntimeRunStartEvent
  | RuntimeRunMessageEvent
  | RuntimeRunMessageDeltaEvent
  | RuntimeRunProgressEvent
  | RuntimeRunErrorEvent
  | RuntimeRunEndEvent;
