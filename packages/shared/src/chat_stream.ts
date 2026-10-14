import type { ToolCallApprovalAsk } from '@shared/tool_call_approval_ask';

export type ChatStreamEventType =
  | 'run_started'
  | 'run_updated'
  | 'item_started'
  | 'item_delta'
  | 'item_updated'
  | 'item_completed'
  | 'item_failed'
  | 'run_completed'
  | 'stream_error';

export type ChatThreadItemType =
  | 'assistant_message'
  | 'thinking'
  | 'tool_call'
  | 'artifact'
  | 'source'
  | 'generative_ui';

export type ChatThreadItemStatus = 'pending' | 'streaming' | 'complete' | 'failed' | 'cancelled';

export type StructuredChatError = {
  code: string;
  message: string;
};

export type ChatEventSource = {
  source_type: 'runtime_event' | 'tool_lifecycle' | 'system' | 'replay';
  runtime_event_id?: string;
  runtime_event_sequence?: number;
  provider_key?: string;
  model_id?: string;
};

export type ChatThreadItemBase = {
  item_id: string;
  workspace_id: string;
  session_id: string;
  run_id: string;
  item_type: ChatThreadItemType;
  item_status: ChatThreadItemStatus;
  item_sequence: number;
  created_time: string;
  last_updated_time: string;
};

export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'markdown'; markdown: string }
  | { type: 'image'; image_id?: string; url?: string; mime_type?: string; detail?: string }
  | { type: 'file'; file_id?: string; name?: string; mime_type?: string }
  | { type: 'tool_reference'; tool_call_id: string }
  | { type: 'artifact_reference'; file_id: string }
  | { type: 'source_reference'; source_id: string }
  | { type: 'generative_ui'; renderer_key: string; ui_spec: unknown };

export type AssistantMessageItem = ChatThreadItemBase & {
  item_type: 'assistant_message';
  message_id?: string;
  role: 'assistant';
  parts: ChatContentPart[];
};

export type ThinkingItem = ChatThreadItemBase & {
  item_type: 'thinking';
  text: string;
  reasoning_level?: string;
  is_collapsed_by_default: boolean;
};

export type ToolCallItem = ChatThreadItemBase & {
  item_type: 'tool_call';
  tool_call_id: string;
  parent_item_id?: string;
  provider_tool_call_id?: string;
  tool_name: string;
  tool_kind: 'command' | 'file' | 'browser' | 'integration' | 'workflow' | 'custom';
  tool_status: string;
  input_data?: unknown;
  output_data?: unknown;
  output_text?: string;
  error?: StructuredChatError;
  duration_ms?: number;
  file_ids: string[];
  stored_output?: StoredToolItemOutput;
  approval?: ToolCallApprovalAsk;
};

export type StoredToolItemOutput = {
  shape: 'chat_tool_item_v2';
  input_data_from?: 'tool_call_row' | 'assistant_tool_call';
  output_data_from?: 'tool_call_row' | 'null' | 'model_tool_result';
  output_text_from?: 'tool_call_row' | 'model_tool_result';
  model_result_metadata?: Record<string, unknown>;
  model_result_terminates_run?: true;
};

export type ArtifactItem = ChatThreadItemBase & {
  item_type: 'artifact';
  file_id: string;
  file_purpose: 'text' | 'code' | 'sheet' | 'image' | 'json' | 'file' | 'html' | 'custom';
  title: string;
  content?: string;
  content_preview?: string;
  source_tool_call_id?: string;
};

export type SourceItem = ChatThreadItemBase & {
  item_type: 'source';
  source: {
    source_id: string;
    title?: string;
    url?: string;
    provider_key?: string;
    citation_text?: string;
    metadata?: Record<string, unknown>;
  };
};

export type GenerativeUiItem = ChatThreadItemBase & {
  item_type: 'generative_ui';
  renderer_key: string;
  ui_spec: unknown;
  ui_spec_format: 'json-render' | 'custom';
};

export type ChatThreadItem =
  | AssistantMessageItem
  | ThinkingItem
  | ToolCallItem
  | ArtifactItem
  | SourceItem
  | GenerativeUiItem;

export type ChatItemDelta =
  | { delta_type: 'text_delta'; text: string }
  | { delta_type: 'markdown_delta'; markdown: string }
  | { delta_type: 'thinking_delta'; text: string }
  | { delta_type: 'tool_input_delta'; input_delta: unknown }
  | { delta_type: 'tool_output_delta'; output_delta: unknown; output_text_delta?: string }
  | { delta_type: 'artifact_content_delta'; file_id: string; content_delta: unknown }
  | { delta_type: 'generative_ui_delta'; ui_spec_delta: unknown };

export type ChatStreamEventEnvelope = {
  event_id: string;
  workspace_id: string;
  session_id: string;
  run_id: string;
  sequence: number;
  event_type: ChatStreamEventType;
  occurred_time: string;
  source: ChatEventSource;
};

export type ChatStreamEventDraft =
  | {
      event_type: 'run_started' | 'run_updated' | 'run_completed';
      run_status: string;
      source: ChatEventSource;
    }
  | {
      event_type: 'item_started' | 'item_completed';
      item: ChatThreadItem;
      source: ChatEventSource;
    }
  | {
      event_type: 'item_delta';
      item_id: string;
      delta: ChatItemDelta;
      source: ChatEventSource;
    }
  | {
      event_type: 'item_updated';
      item_id: string;
      patch: Partial<ChatThreadItem>;
      source: ChatEventSource;
    }
  | {
      event_type: 'item_failed';
      item_id: string;
      error: StructuredChatError;
      source: ChatEventSource;
    }
  | {
      event_type: 'stream_error';
      error: StructuredChatError;
      source: ChatEventSource;
    };

export type ChatStreamEvent = ChatStreamEventEnvelope & ChatStreamEventDraft;
