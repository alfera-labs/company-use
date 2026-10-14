import { z } from 'zod';

/** What a chat needs to ask a person about a held tool call, without a second read. */
export type ToolCallApprovalAsk = {
  approval_request_id: string;
  needs_a_person: boolean;
  labels: string[];
  display_fields?: string[];
};

const held_tool_call_metadata_schema = z.object({
  approval_request_id: z.string().min(1),
  approval_needs_a_person: z.boolean().default(true),
  approval_labels: z.array(z.string()).default([]),
  approval_display_fields: z.array(z.string()).optional(),
});

/**
 * A held tool call keeps its approval request in its metadata. The live chat item carries it too,
 * so the chat can ask the person the moment the call stops.
 */
export function read_tool_call_approval_ask(
  tool_call_metadata: Record<string, unknown>,
): { approval: ToolCallApprovalAsk } | Record<string, never> {
  const held = held_tool_call_metadata_schema.safeParse(tool_call_metadata);
  if (!held.success) return {};
  const { approval_display_fields: display_fields } = held.data;
  return {
    approval: {
      approval_request_id: held.data.approval_request_id,
      needs_a_person: held.data.approval_needs_a_person,
      labels: held.data.approval_labels,
      ...(display_fields ? { display_fields } : {}),
    },
  };
}
