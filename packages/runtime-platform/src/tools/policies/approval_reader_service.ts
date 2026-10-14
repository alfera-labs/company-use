import type { Database } from '@coworker/core';
import {
  read_calls_a_person_is_asked_about,
  tool_policy_approval_wait_schema,
} from '@coworker/core/access/tool_policy_approval_schema';
import { get_visible_tool_catalog_entry } from '@coworker/core/db/queries/catalog';
import { get_run, get_tool_call } from '@coworker/core/db/queries/sessions';
import { get_user, user_display_name } from '@coworker/core/db/queries/users';
import type { event_jobs } from '@coworker/core/db/schema';
import { apps } from '@coworker/core/db/schema';
import { eq } from 'drizzle-orm';

type EventJob = typeof event_jobs.$inferSelect;

type ToolApprovalCallView = {
  tool_call_id: string;
  node_key: string;
  app_display_name: string | null;
  action_display_name: string | null;
  tool_status: string;
  app_icon_url: string | null;
  app_auth_type: string | null;
  labels: string[];
  input: unknown;
  input_schema: unknown;
  approval_display_fields: string[];
};

export type ToolApprovalView = {
  job_id: string;
  job_status: string;
  session_id: string;
  run_id: string;
  requested_time: string;
  expires_time: string | null;
  requested_by: string | null;
  requested_by_name: string | null;
  automation_id: string | null;
  eligible_user_ids: string[];
  question: string | null;
  calls: ToolApprovalCallView[];
};

export async function read_tool_approval_views(
  db: Database,
  input: { workspace_id: string; waits: readonly EventJob[] },
): Promise<ToolApprovalView[]> {
  const views = await Promise.all(
    input.waits.map((wait) => read_tool_approval_view(db, input.workspace_id, wait)),
  );
  return views.flatMap((view) => (view ? [view] : []));
}

export async function read_tool_approval_view(
  db: Database,
  workspace_id: string,
  wait: EventJob,
): Promise<ToolApprovalView | null> {
  const parsed = tool_policy_approval_wait_schema.safeParse(wait.metadata.policy_approval);
  if (!parsed.success) return null;

  const approval_calls = read_calls_a_person_is_asked_about(parsed.data);
  const [calls, requester, run] = await Promise.all([
    Promise.all(approval_calls.map((call) => read_call_view(db, workspace_id, call.tool_call_id))),
    parsed.data.requested_by ? get_user(db, parsed.data.requested_by) : Promise.resolve(null),
    get_run(db, workspace_id, parsed.data.source_run_id),
  ]);

  return {
    job_id: wait.job_id,
    job_status: wait.job_status,
    session_id: parsed.data.session_id,
    run_id: parsed.data.source_run_id,
    requested_time: wait.created_time.toISOString(),
    expires_time: wait.awaits_until_time?.toISOString() ?? null,
    requested_by: parsed.data.requested_by,
    requested_by_name: requester ? user_display_name(requester) : null,
    automation_id: run?.automation_id ?? null,
    eligible_user_ids: parsed.data.eligible_user_ids,
    question: parsed.data.version === 2 ? (parsed.data.question ?? null) : null,
    calls: calls.flatMap((call) => (call ? [call] : [])),
  };
}

async function read_app_display(db: Database, app_id: string | undefined) {
  const nothing = { icon_url: null, auth_type: null };
  if (!app_id) return nothing;
  const app = await db.query.apps.findFirst({ where: eq(apps.app_id, app_id) });
  if (!app) return nothing;

  const metadata = app.metadata as { icon_url?: string } | null;
  const display_config = app.display_config as { icon_url?: string } | null;
  return {
    icon_url: metadata?.icon_url ?? display_config?.icon_url ?? null,
    auth_type: app.auth_type ?? null,
  };
}

function read_labels(tool_call: { tool_call_metadata?: Record<string, unknown> | null }) {
  return read_string_list(tool_call.tool_call_metadata?.approval_labels);
}

function read_string_list(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

async function read_call_view(
  db: Database,
  workspace_id: string,
  tool_call_id: string,
): Promise<ToolApprovalCallView | null> {
  const tool_call = await get_tool_call(db, workspace_id, tool_call_id);
  if (!tool_call) return null;

  const catalog_entry = await get_visible_tool_catalog_entry(db, {
    workspace_id,
    node_key: tool_call.tool_name,
  });
  const app_display = await read_app_display(db, catalog_entry?.app_id);
  return {
    tool_call_id,
    node_key: tool_call.tool_name,
    app_display_name: catalog_entry?.app_display_name ?? null,
    action_display_name: catalog_entry?.node_display_name ?? null,
    tool_status: tool_call.tool_status,
    app_icon_url: app_display.icon_url,
    app_auth_type: app_display.auth_type,
    labels: read_labels(tool_call),
    input: tool_call.input_data,
    input_schema: catalog_entry?.input_schema ?? null,
    approval_display_fields: read_string_list(
      tool_call.tool_call_metadata?.approval_display_fields,
    ),
  };
}
