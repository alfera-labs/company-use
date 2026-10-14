import type { ToolCallApprovalAsk } from '@coworker/shared';

type LiveToolCallItem = {
  provider_tool_call_id?: string;
  approval?: ToolCallApprovalAsk;
};

/** The metadata of a tool call that arrived on the live stream, in the shape a stored call has. */
export function read_live_tool_call_metadata(item: LiveToolCallItem) {
  return {
    source: 'chat_event',
    ...(item.provider_tool_call_id ? { runtime_tool_call_id: item.provider_tool_call_id } : {}),
    ...(item.approval
      ? {
          approval_request_id: item.approval.approval_request_id,
          approval_needs_a_person: item.approval.needs_a_person,
          approval_labels: item.approval.labels,
          ...(item.approval.display_fields
            ? { approval_display_fields: item.approval.display_fields }
            : {}),
        }
      : {}),
  };
}
