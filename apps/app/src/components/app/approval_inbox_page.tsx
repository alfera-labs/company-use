// biome-ignore-all lint/correctness/useHookAtTopLevel: Repository hook names use snake_case.

import { public_brand_config } from '@coworker/config/public_env';
import {
  describe_approval_call,
  no_label,
  read_tool_input_fields,
  yes_label,
} from '@coworker/shared';
import { Skeleton } from '@coworker/ui/components/skeleton';
import { cn } from '@coworker/ui/lib/utils';
import { Link } from '@tanstack/react-router';
import { Check, Inbox, Loader2, X } from 'lucide-react';
import { AppMark } from '@/components/app/app_mark';
import {
  use_pending_tool_approvals,
  use_tool_approval_decision,
} from '@/components/app/tool_approval_decision';
import { ToolInputFieldList } from '@/components/app/tool_input_field_list';
import type { ToolApproval } from '@/lib/api/types';

type ToolApprovalCall = ToolApproval['calls'][number];

export function ApprovalInboxPage() {
  const approvals = use_pending_tool_approvals();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 pb-10">
      <header className="mt-1 grid max-w-[65ch] gap-1">
        <h1 className="font-semibold text-xl text-balance">Things waiting for you</h1>
        <p className="text-muted-foreground text-sm">
          {public_brand_config.product_brand_name} stopped and is waiting to hear from you before it
          does any of these. None of them have happened.
        </p>
      </header>
      {approvals.isPending ? (
        <ApprovalSkeleton />
      ) : approvals.isError ? (
        <button
          className="panel p-5 text-left text-destructive text-sm"
          onClick={() => void approvals.refetch()}
          type="button"
        >
          The inbox could not load. Select this message to retry.
        </button>
      ) : approvals.data.length === 0 ? (
        <EmptyInbox />
      ) : (
        <div className="grid gap-2.5">
          {approvals.data.map((approval) => (
            <ApprovalCard approval={approval} key={approval.job_id} />
          ))}
        </div>
      )}
    </main>
  );
}

function ApprovalCard({ approval }: { approval: ToolApproval }) {
  const decide = use_tool_approval_decision(approval.job_id);
  const [first] = approval.calls;

  return (
    <article className={cn('overflow-hidden rounded-[14px] border bg-raised', 'border-border')}>
      <header className="flex items-start gap-[11px] px-[16px] pt-[15px]">
        <AppMark
          name={first?.app_display_name ?? first?.node_key ?? 'A'}
          {...(first?.app_icon_url ? { iconUrl: first.app_icon_url } : {})}
        />
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] text-foreground">
            <span className="font-semibold">{public_brand_config.product_brand_name}</span> wants to{' '}
            <span className="font-semibold">{describe_approval(approval)}</span>
          </h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            It asked {relative_ask_time(approval.requested_time)}
            {approval.requested_by_name ? `, while helping ${approval.requested_by_name}` : ''} ·{' '}
            <Link
              className="underline decoration-border underline-offset-2 hover:decoration-foreground"
              to="/chats/{-$session_id}"
              params={{ session_id: approval.session_id }}
            >
              Open the chat
            </Link>
          </p>
        </div>
      </header>

      <div className="grid gap-2 px-[16px] pt-3.5">
        {approval.calls.map((call) => (
          <ApprovalCallDetail
            call={call}
            key={call.tool_call_id}
            showTitle={approval.calls.length > 1}
          />
        ))}
      </div>

      <footer className="flex flex-wrap items-center justify-end gap-1.5 px-[16px] pt-2.5 pb-[15px]">
        {decide.isSuccess ? (
          <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
            {decide.variables?.decision === 'denied' ? (
              <X aria-hidden="true" className="size-[14px] stroke-[1.6]" />
            ) : (
              <Check aria-hidden="true" className="size-[14px] stroke-[1.6]" />
            )}
            {decide.variables?.decision === 'denied'
              ? 'Alright, it will not do it.'
              : 'Alright, doing it now.'}
          </span>
        ) : (
          <>
            <button
              className="rounded-full border border-border px-[15px] py-[9px] text-[13px] text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
              disabled={decide.isPending}
              onClick={() => decide.mutate({ decision: 'denied' })}
              type="button"
            >
              {no_label(first_action_name(approval))}
            </button>
            <button
              className={cn(
                'flex items-center gap-1.5 rounded-full px-[15px] py-[9px] font-medium text-[13px] transition-colors',
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
              {yes_label(first_action_name(approval))}
            </button>
          </>
        )}
      </footer>
    </article>
  );
}

function ApprovalCallDetail({ call, showTitle }: { call: ToolApprovalCall; showTitle: boolean }) {
  const fields = read_tool_input_fields(
    call.input,
    call.input_schema,
    call.approval_display_fields,
  );

  return (
    <div className="rounded-[10px] bg-sunken px-3.5 py-3">
      {showTitle ? (
        <h3 className="mb-2 font-medium text-[13px]">{describe_approval_call(call)}</h3>
      ) : null}
      {fields.length > 0 ? (
        <ToolInputFieldList fields={fields} />
      ) : (
        <p className="text-[13px] text-muted-foreground">No details to check.</p>
      )}
    </div>
  );
}

function describe_approval(approval: ToolApproval) {
  const [first] = approval.calls;
  if (!first) return 'do something';
  if (approval.calls.length === 1) return describe_approval_call(first);
  return `${describe_approval_call(first)}, and ${approval.calls.length - 1} more thing${approval.calls.length === 2 ? '' : 's'}`;
}

function first_action_name(approval: ToolApproval) {
  const [first] = approval.calls;
  return first?.action_display_name ?? first?.node_key ?? 'Do it';
}

function EmptyInbox() {
  return (
    <div className="grid place-items-center gap-2 rounded-[14px] border border-border p-12 text-center">
      <span className="grid size-10 place-items-center rounded-full bg-sunken">
        <Inbox aria-hidden="true" className="size-5 text-muted-foreground" />
      </span>
      <h2 className="font-medium text-sm">Nothing is waiting for you</h2>
      <p className="max-w-[42ch] text-muted-foreground text-xs">
        When {public_brand_config.product_brand_name} wants to do something you might not want it
        to, it stops and asks here first.
      </p>
    </div>
  );
}

function ApprovalSkeleton() {
  return (
    <div className="grid gap-2.5">
      <Skeleton className="h-40 w-full rounded-[14px]" />
      <Skeleton className="h-40 w-full rounded-[14px]" />
    </div>
  );
}

function relative_ask_time(value: string) {
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  return new Date(value).toLocaleDateString();
}
