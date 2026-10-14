import { z } from 'zod';

const sha256_hex = z.string().regex(/^[a-f0-9]{64}$/);

const tool_policy_approval_wait_v1_schema = z
  .object({
    version: z.literal(1),
    kind: z.literal('tool_policy_approval'),
    session_id: z.string().min(1),
    source_run_id: z.string().min(1),
    tool_call_id: z.string().min(1),
    node_key: z.string().min(1),
    connection_id: z.string().min(1).nullable(),
    input_sha256: sha256_hex,
    tool_input_preview: z.string(),
    requested_by: z.string().min(1).nullable(),
    eligible_user_ids: z.array(z.string().min(1)),
  })
  .strict();

export const tool_policy_approval_call_schema = z
  .object({
    tool_call_id: z.string().min(1),
    input_sha256: sha256_hex,
    needs_a_person: z.boolean().optional(),
  })
  .strict();

const tool_policy_approval_wait_v2_schema = z
  .object({
    version: z.literal(2),
    kind: z.literal('tool_policy_approval'),
    session_id: z.string().min(1),
    source_run_id: z.string().min(1),
    calls: z.array(tool_policy_approval_call_schema).min(1),
    requested_by: z.string().min(1).nullable(),
    eligible_user_ids: z.array(z.string().min(1)),
    question: z.string().min(1).optional(),
  })
  .strict();

export const tool_policy_approval_wait_schema = z.union([
  tool_policy_approval_wait_v2_schema,
  tool_policy_approval_wait_v1_schema,
]);

export type ToolPolicyApprovalWait = z.infer<typeof tool_policy_approval_wait_schema>;

export function read_approval_calls(wait: ToolPolicyApprovalWait) {
  if (wait.version === 2) return wait.calls;
  return [{ tool_call_id: wait.tool_call_id, input_sha256: wait.input_sha256 }];
}

export function read_calls_a_person_is_asked_about(wait: ToolPolicyApprovalWait) {
  const asked = read_approval_calls(wait).filter((call) => calls_for_a_person(call));
  return asked.length > 0 ? asked : read_approval_calls(wait);
}

function calls_for_a_person(call: { needs_a_person?: boolean | undefined }) {
  return call.needs_a_person !== false;
}

export const tool_policy_awaiting_approval_event_label = 'tool_policy.awaiting_approval';

export const tool_policy_decision_schema = z
  .object({
    job_id: z.string().min(1),
    decision: z.enum(['approved', 'denied']),
    reason: z.string().optional(),
  })
  .strict();
