import type { RunMessageContentData } from '@coworker/core/db/schema/json_column_types';

export type MessageForContext = {
  run_message_id: string;
  message_role: string;
  message_content?: RunMessageContentData;
  tool_call_id?: string | null;
  is_model_visible?: boolean;
  token_count?: number | null;
};

export const context_message_roles = new Set(['user', 'assistant', 'tool_result']);
