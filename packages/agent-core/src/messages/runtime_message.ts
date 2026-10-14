import type { RuntimeToolResult } from '@agent-core/tools/runtime_tool_result';

type RuntimeAgentMessageRole = 'system' | 'user' | 'assistant' | 'tool';

type RuntimeTextMessagePart = {
  type: 'text';
  text: string;
  text_signature?: string;
};

type RuntimeJsonMessagePart = {
  type: 'json';
  json: unknown;
};

type RuntimeToolResultMessagePart = {
  type: 'tool_result';
  tool_call_id?: string;
  tool_name?: string;
  result: RuntimeToolResult;
};

export type RuntimeImageMessagePart = {
  type: 'image';
  data: string;
  mime_type: string;
  detail?: 'auto' | 'low' | 'high';
  source?: string;
};

export type RuntimeFileMessagePart = {
  type: 'file';
  file_id?: string;
  path?: string;
  url?: string;
  name?: string;
  mime_type?: string;
  text?: string;
};

type RuntimeThinkingMessagePart = {
  type: 'thinking';
  thinking: string;
  signature?: string;
  redacted?: boolean;
};

export type RuntimeToolCallMessagePart = {
  type: 'tool_call';
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  thought_signature?: string;
};

export type RuntimeAgentMessagePart =
  | RuntimeTextMessagePart
  | RuntimeJsonMessagePart
  | RuntimeToolResultMessagePart
  | RuntimeImageMessagePart
  | RuntimeFileMessagePart
  | RuntimeThinkingMessagePart
  | RuntimeToolCallMessagePart;

export type RuntimeAgentUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
};

type RuntimeAgentMessageMetadata = Record<string, unknown> & {
  usage?: RuntimeAgentUsage;
};

export type RuntimeAgentMessage = {
  role: RuntimeAgentMessageRole;
  content: RuntimeAgentMessagePart[];
  name?: string;
  tool_call_id?: string;
  metadata?: RuntimeAgentMessageMetadata;
};
