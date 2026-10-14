import { allow_tools_in_this_chat } from '@api/services/policies/allow_tools_in_this_chat';
import {
  always_allow_tool_calls,
  type PolicyGrantInput,
  type ToolRemembered,
} from '@api/services/policies/always_allow_tool_node';
import type { Database } from '@coworker/core';
import { read_approval_batch } from '@runtime-platform/tools/policies/approval_batch_grant';
import { allow_days } from '@runtime-platform/tools/policies/approval_card_parts';
import type { ToolApprovalView } from '@runtime-platform/tools/policies/approval_reader_service';

const approval_grant_kinds = [
  'none',
  'chat',
  'perpetual',
  'time_bounded',
  'automation',
  'batch',
] as const;
export type ApprovalGrantKind = (typeof approval_grant_kinds)[number];

export type ApprovalRemembered = {
  remembered: ToolRemembered | null;
  remembered_in_this_chat: { remembered: boolean } | null;
  grant_label: string | null;
};

export async function remember_the_approval(
  db: Database,
  input: {
    workspace_id: string;
    user_id: string;
    session_id: string;
    tool_call_ids: readonly string[];
    kind: ApprovalGrantKind;
    view: ToolApprovalView | null;
  },
): Promise<ApprovalRemembered> {
  const nothing = { remembered: null, remembered_in_this_chat: null, grant_label: null };
  if (input.kind === 'none') return nothing;
  if (input.kind === 'chat') {
    return {
      remembered: null,
      remembered_in_this_chat: await allow_tools_in_this_chat(db, input),
      grant_label: 'in this chat',
    };
  }

  const grant = build_grant(input.kind, input.view);
  if (!grant) return nothing;
  return {
    remembered: await always_allow_tool_calls(db, { ...input, grant: grant.grant }),
    remembered_in_this_chat: null,
    grant_label: grant.label,
  };
}

function build_grant(
  kind: Exclude<ApprovalGrantKind, 'none' | 'chat'>,
  view: ToolApprovalView | null,
): { grant: PolicyGrantInput; label: string } | null {
  if (kind === 'perpetual') return { grant: { grant_scope: 'perpetual' }, label: 'from now on' };
  if (kind === 'time_bounded') {
    return {
      grant: { grant_scope: 'time_bounded', expires_time: days_from_now(allow_days) },
      label: `for the next ${allow_days} days`,
    };
  }
  if (kind === 'automation') {
    if (!view?.automation_id) return null;
    return {
      grant: { grant_scope: 'task', automation_id: view.automation_id },
      label: 'inside this automation',
    };
  }
  const batch = view ? read_approval_batch(view) : null;
  if (!batch) return null;
  return {
    grant: {
      grant_scope: 'task',
      template: { fields: batch.template_fields, sha256: batch.template_sha256 },
      max_per_day: batch.max_per_day,
    },
    label: `for this exact message, up to ${batch.max_per_day} a day`,
  };
}

function days_from_now(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}
