export type ChoicesWaitData = {
  version: 1;
  kind: 'choices_wait';
  session_id: string;
  source_run_id: string;
  asked_by: string | null;
  eligible_user_ids: string[];
  tool_call_id?: string;
};

export type ToolPolicyApprovalCallData = {
  tool_call_id: string;
  input_sha256: string;
  needs_a_person?: boolean | undefined;
};

type ToolPolicyApprovalWaitDataV1 = {
  version: 1;
  kind: 'tool_policy_approval';
  session_id: string;
  source_run_id: string;
  tool_call_id: string;
  node_key: string;
  connection_id: string | null;
  input_sha256: string;
  tool_input_preview: string;
  requested_by: string | null;
  eligible_user_ids: string[];
};

export type ToolPolicyApprovalWaitDataV2 = {
  version: 2;
  kind: 'tool_policy_approval';
  session_id: string;
  source_run_id: string;
  calls: ToolPolicyApprovalCallData[];
  requested_by: string | null;
  eligible_user_ids: string[];
  question?: string;
};

export type ToolPolicyApprovalWaitData =
  | ToolPolicyApprovalWaitDataV1
  | ToolPolicyApprovalWaitDataV2;

export type ToolPolicyApprovalGrantData =
  | {
      version: 1;
      answer?: 'just_given';
      job_id: string;
      node_key: string;
      input_sha256: string;
      decision_event_id: string;
      tool_call_id?: string;
    }
  | {
      version: 1;
      answer: 'already_given';
      node_key: string;
      input_sha256: string;
    };
