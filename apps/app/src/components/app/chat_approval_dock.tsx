import { public_brand_config } from '@coworker/config/public_env';
import {
  describe_the_action_in_place,
  find_tool_call_subjects,
  no_label,
  read_tool_input_fields,
  type ToolCallSubject,
  type ToolInputField,
  tool_call_subject_policy_id,
  yes_label,
} from '@coworker/shared';
import { cn } from '@coworker/ui/lib/utils';
import { Check, Loader2, X } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';
import { AppMark } from '@/components/app/app_mark';
import { ActivityChevron, activity_row_class_name } from '@/components/app/chat_activity_row';
import {
  is_chat_tool_part,
  type ProjectedChatMessage,
  type ProjectedChatMessagePart,
} from '@/components/app/chat_stream_projection';
import { use_tool_approval_decision } from '@/components/app/tool_approval_decision';
import { ToolInputFieldList } from '@/components/app/tool_input_field_list';
import { tool_part_display, tool_part_place_name } from '@/components/app/tool_part_app_display';
import type { CatalogApp } from '@/lib/api';

export type ApprovalRequest = {
  approval_request_id: string;
  tool_call_id: string;
  tool_name: string;
  action_name: string;
  app_name?: string | undefined;
  icon_url?: string | undefined;
  who: string;
  what_it_wants_to_do: string;
  yes_label: string;
  no_label: string;
  fields: ToolInputField[];
  subject?: ToolCallSubject | undefined;
  sibling_call_count?: number | undefined;
};

const bar_entrance_transition = { duration: 0.34, ease: [0.22, 1, 0.36, 1] as const };
const receipt_ms = 900;

export function ChatApprovalDock({
  apps,
  messages,
}: {
  apps: CatalogApp[];
  messages: ProjectedChatMessage[];
}) {
  const requests = latest_approval_requests(messages, apps);
  if (requests.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5 pb-2">
      {requests.map((request) => (
        <ApprovalActionBar key={request.approval_request_id} request={request} />
      ))}
    </div>
  );
}

type BarPhase = 'asking' | 'receipt' | 'gone';

function ApprovalActionBar({ request }: { request: ApprovalRequest }) {
  const decide = use_tool_approval_decision(request.approval_request_id);
  const reduce_motion = useReducedMotion();
  const [phase, set_phase] = useState<BarPhase>('asking');
  const answer = decide.variables?.decision;

  useEffect(() => {
    if (decide.isIdle) return;
    if (decide.isError) {
      set_phase('asking');
      return;
    }
    set_phase('receipt');
    if (!decide.isSuccess) return;
    const timer = setTimeout(() => set_phase('gone'), receipt_ms);
    return () => clearTimeout(timer);
  }, [decide.isIdle, decide.isError, decide.isSuccess]);

  if (phase === 'gone') return null;

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'flex items-start gap-[11px] rounded-[14px] border bg-raised px-[14px] py-[13px]',
        'border-border',
      )}
      exit={{ opacity: 0, y: 3 }}
      initial={reduce_motion ? false : { opacity: 0, y: 4 }}
      role={phase === 'receipt' ? 'status' : 'group'}
      transition={reduce_motion ? { duration: 0 } : bar_entrance_transition}
    >
      <AppMark
        name={request.app_name ?? request.action_name}
        {...(request.icon_url ? { iconUrl: request.icon_url } : {})}
      />
      {phase === 'receipt' ? (
        <ApprovalReceipt actionName={request.action_name} answer={answer} />
      ) : (
        <div className="min-w-0 flex-1">
          <p className="text-[14.5px] text-foreground">
            <span className="font-semibold">{request.who}</span> wants to{' '}
            <span className="font-semibold">{request.what_it_wants_to_do}</span>
            {(request.sibling_call_count ?? 1) > 1 ? (
              <span className="text-muted-foreground">
                {' '}
                and {(request.sibling_call_count ?? 1) - 1} more step
                {(request.sibling_call_count ?? 1) > 2 ? 's' : ''} — one answer covers all of them
              </span>
            ) : null}
          </p>
          <ToolInputFieldList fields={request.fields} />
          <div className="mt-2.5 flex flex-wrap items-center justify-end gap-1.5">
            <button
              className="shrink-0 rounded-full border border-border px-[15px] py-[9px] text-[13px] text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
              disabled={decide.isPending}
              onClick={() => decide.mutate({ decision: 'denied' })}
              type="button"
            >
              {request.no_label}
            </button>
            {request.subject ? (
              <button
                className="shrink-0 rounded-full border border-border px-[15px] py-[9px] text-[13px] transition-colors hover:bg-hover"
                disabled={decide.isPending}
                onClick={() =>
                  decide.mutate({
                    decision: 'approved',
                    always_allow_subject: tool_call_subject_policy_id(
                      request.subject as ToolCallSubject,
                      request.tool_name,
                    ),
                  })
                }
                type="button"
              >
                {always_allow_label(request.subject, request.action_name)}
              </button>
            ) : null}
            {!request.subject ? (
              <button
                className="shrink-0 rounded-full border border-border px-[15px] py-[9px] text-[13px] transition-colors hover:bg-hover"
                disabled={decide.isPending}
                onClick={() => decide.mutate({ decision: 'approved', always_allow_tools: true })}
                type="button"
              >
                Always allow
              </button>
            ) : null}
            <button
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-full px-[15px] py-[9px] font-medium text-[13px] transition-colors',
                'bg-foreground text-background hover:bg-foreground/80',
              )}
              disabled={decide.isPending}
              onClick={() => decide.mutate({ decision: 'approved' })}
              type="button"
            >
              {decide.isPending ? (
                <Loader2 aria-hidden="true" className="size-[13px] animate-spin" />
              ) : (
                <Check aria-hidden="true" className="size-[13px] stroke-[2]" />
              )}
              {request.yes_label}
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
}

function ApprovalReceipt({
  actionName,
  answer,
}: {
  actionName: string;
  answer: 'approved' | 'denied' | undefined;
}) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[14.5px] text-foreground">
      {answer === 'denied' ? (
        <X aria-hidden="true" className="size-[15px] shrink-0 stroke-[1.5]" />
      ) : (
        <Check aria-hidden="true" className="size-[15px] shrink-0 stroke-[1.5]" />
      )}
      {answer === 'denied'
        ? `Alright, it will not ${lower_verb(actionName)}`
        : 'Alright, doing it now'}
    </span>
  );
}

export function ApprovalTraceRow({
  actionName,
  appName,
  iconUrl,
  placeName,
  state,
}: {
  actionName: string;
  appName?: string | undefined;
  iconUrl?: string | undefined;
  placeName?: string | undefined;
  state: string;
}) {
  return (
    <div className={cn(activity_row_class_name, 'w-fit max-w-full')}>
      <ActivityChevron expandable={false} open={false} />
      <AppMark
        className="mt-[3px] size-[15px]"
        name={appName ?? actionName}
        {...(iconUrl ? { iconUrl } : {})}
      />
      <span className="min-w-0">
        Asked to {describe_the_action_in_place(actionName, placeName)}
        <span className="ml-1 text-muted-foreground">· {approval_trace_words(state)}</span>
      </span>
    </div>
  );
}

const always_allow_wording: Record<
  ToolCallSubject['kind'],
  (name: string, verb: string) => string
> = {
  recipient: (name, verb) => `Always ${verb} to ${name}`,
  command: (name) => `Always allow ${name}`,
  website: (name) => `Always allow ${name}`,
};

function always_allow_label(subject: ToolCallSubject, action_name: string) {
  const verb = action_name.trim().split(/\s+/u)[0]?.toLowerCase() ?? 'allow';
  return always_allow_wording[subject.kind](subject.display_name, verb);
}

function lower_verb(action_name: string) {
  return action_name.trim().split(/\s+/u)[0]?.toLowerCase() ?? 'do it';
}

function approval_trace_words(state: string) {
  if (state === 'denied') return 'you said no to this';
  return 'waiting for your answer';
}

export function latest_approval_requests(
  messages: ProjectedChatMessage[],
  apps: CatalogApp[] = [],
): ApprovalRequest[] {
  const last_assistant = [...messages].reverse().find((message) => message.role === 'assistant');
  const requests_by_approval = new Map<string, ApprovalRequest>();

  for (const part of last_assistant?.parts ?? []) {
    const request = approval_request_from_part(part, apps);
    if (!request) continue;
    const existing = requests_by_approval.get(request.approval_request_id);
    requests_by_approval.set(request.approval_request_id, {
      ...(existing ?? request),
      sibling_call_count: (existing?.sibling_call_count ?? 0) + 1,
    });
  }
  return [...requests_by_approval.values()];
}

function approval_request_from_part(
  part: ProjectedChatMessagePart,
  apps: CatalogApp[],
): ApprovalRequest | null {
  if (!is_chat_tool_part(part)) return null;
  if (part.state !== 'awaiting_approval' || !part.approvalRequestId) return null;
  if (part.approvalNeedsAPerson === false) return null;

  const display = tool_part_display(part, apps);
  const action_name = display?.title ?? part.display?.title ?? part.toolName;
  const app_name = display?.subtitle;
  const place_name = tool_part_place_name(part, apps);
  const [subject] = find_tool_call_subjects(part.input);
  return {
    approval_request_id: part.approvalRequestId,
    tool_call_id: part.toolCallId,
    tool_name: part.toolName,
    action_name,
    ...(app_name ? { app_name } : {}),
    ...(display?.iconUrl ? { icon_url: display.iconUrl } : {}),
    who: public_brand_config.product_brand_name,
    what_it_wants_to_do: describe_the_action_in_place(action_name, place_name),
    yes_label: yes_label(action_name),
    no_label: no_label(action_name),
    fields: read_tool_input_fields(part.input, part.inputSchema, part.approvalDisplayFields),
    ...(subject ? { subject } : {}),
  };
}
