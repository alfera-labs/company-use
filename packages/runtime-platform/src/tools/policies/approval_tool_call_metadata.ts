import { build_tool_policy_resources } from '@coworker/core/access/tool_policy_resources';
import type { ToolPolicyCallTarget } from '@runtime-platform/tools/policies/tool_policy_call';

/** Builds the metadata a tool call keeps while it waits for a person to approve it. */
export function build_approval_tool_call_metadata(input: {
  target: ToolPolicyCallTarget;
  approval_request_id: string;
  eligible_user_ids: readonly string[];
  needs_a_person?: boolean;
}) {
  return {
    connection_id: input.target.connection_id,
    called_tool_name: input.target.called_tool_name,
    runtime_tool_call_id: input.target.tool_call_id,
    approval_request_id: input.approval_request_id,
    approval_eligible_user_ids: [...input.eligible_user_ids],
    approval_needs_a_person: input.needs_a_person ?? true,
    approval_labels: read_approval_labels(input.target),
    ...(input.target.metadata?.approval_display_fields
      ? { approval_display_fields: input.target.metadata.approval_display_fields }
      : {}),
  };
}

function read_approval_labels(target: ToolPolicyCallTarget) {
  return build_tool_policy_resources({
    node_key: target.node_key,
    approval_policy: target.approval_policy,
    metadata: target.metadata,
  })
    .filter((resource) => resource.resource_type === 'node_label')
    .map((resource) => resource.resource_id);
}
