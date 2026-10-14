import type { Database } from '@coworker/core/db/connection';
import { connections, run_messages, runs, workspaces } from '@coworker/core/db/schema';
import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';

export type SlackEvalRunCandidate = {
  run_id: string;
  workspace_id: string;
  session_id: string;
  prompt_text: string;
  created_time: Date;
};

export type SlackEvalPromptRun = SlackEvalRunCandidate & {
  run_status: string;
};

export type SlackEvalDispatchTarget = {
  workspace_id: string;
  team_id: string;
  bot_user_id: string;
  installer_user_id: string;
};

export async function get_slack_eval_dispatch_target(
  db: Database,
  input: { workspace_id?: string; workspace_name?: string },
): Promise<SlackEvalDispatchTarget> {
  if (!input.workspace_id && !input.workspace_name) {
    throw new Error('Slack eval dispatch requires workspace_id or workspace_name');
  }

  const rows = await db
    .select({
      workspace_id: connections.workspace_id,
      team_id: connections.external_account_id,
      provider_account: connections.provider_account,
    })
    .from(connections)
    .innerJoin(workspaces, eq(workspaces.workspace_id, connections.workspace_id))
    .where(
      and(
        input.workspace_id
          ? eq(connections.workspace_id, input.workspace_id)
          : eq(workspaces.workspace_name, input.workspace_name as string),
        eq(connections.provider_key, 'native'),
        eq(connections.auth_method_key, 'slack_oauth2_bot'),
        eq(connections.connection_status, 'active'),
      ),
    )
    .limit(2);

  if (rows.length === 0) throw new Error('Active native Slack connection not found.');
  if (rows.length > 1) throw new Error('Multiple active native Slack connections found.');

  const row = rows[0];
  const provider_account = row?.provider_account;
  const team_id = row?.team_id;
  const bot_user_id = provider_account?.bot_user_id;
  const installer_user_id = provider_account?.authed_user?.id;
  if (!row || !team_id || !bot_user_id || !installer_user_id) {
    throw new Error('Native Slack connection is missing dispatch identity metadata.');
  }

  return {
    workspace_id: row.workspace_id,
    team_id,
    bot_user_id,
    installer_user_id,
  };
}

export async function find_latest_slack_eval_prompt_run(
  db: Database,
  input: {
    workspace_id: string;
    prompt: string;
    actor_email?: string;
    channel_id?: string;
    since: Date;
  },
): Promise<SlackEvalPromptRun | null> {
  const [candidate] = await db
    .select({
      run_id: runs.run_id,
      workspace_id: runs.workspace_id,
      session_id: runs.session_id,
      prompt_text: sql<string>`${run_messages.content_text}`,
      created_time: runs.created_time,
      run_status: runs.run_status,
    })
    .from(run_messages)
    .innerJoin(runs, eq(runs.run_id, run_messages.run_id))
    .where(
      and(
        eq(runs.workspace_id, input.workspace_id),
        eq(run_messages.message_role, 'user'),
        eq(run_messages.source_type, 'slack'),
        eq(run_messages.content_text, input.prompt),
        input.actor_email
          ? sql`${run_messages.source_metadata}->'source_actor'->'profile'->>'email' = ${input.actor_email}`
          : undefined,
        input.channel_id
          ? sql`${run_messages.source_metadata}->'slack'->>'channel_id' = ${input.channel_id}`
          : undefined,
        gte(runs.created_time, input.since),
      ),
    )
    .orderBy(desc(runs.created_time))
    .limit(1);

  return candidate ?? null;
}

export async function list_slack_eval_run_candidates(
  db: Database,
  input: {
    prompts: string[];
    workspace_id?: string;
    workspace_name?: string;
    actor_email?: string;
    channel_id?: string;
    since?: Date;
  },
): Promise<SlackEvalRunCandidate[]> {
  if (!input.workspace_id && !input.workspace_name) {
    throw new Error('Slack eval run discovery requires workspace_id or workspace_name');
  }
  if (input.prompts.length === 0) return [];

  const workspace_condition = input.workspace_id
    ? eq(runs.workspace_id, input.workspace_id)
    : eq(workspaces.workspace_name, input.workspace_name as string);
  const actor_condition = input.actor_email
    ? sql`${run_messages.source_metadata}->'source_actor'->'profile'->>'email' = ${input.actor_email}`
    : undefined;

  return db
    .selectDistinctOn([run_messages.content_text], {
      run_id: runs.run_id,
      workspace_id: runs.workspace_id,
      session_id: runs.session_id,
      prompt_text: run_messages.content_text,
      created_time: runs.created_time,
    })
    .from(run_messages)
    .innerJoin(runs, eq(runs.run_id, run_messages.run_id))
    .innerJoin(workspaces, eq(workspaces.workspace_id, runs.workspace_id))
    .where(
      and(
        workspace_condition,
        inArray(runs.run_status, ['completed', 'failed', 'cancelled']),
        eq(run_messages.message_role, 'user'),
        eq(run_messages.source_type, 'slack'),
        inArray(run_messages.content_text, input.prompts),
        actor_condition,
        input.channel_id
          ? sql`${run_messages.source_metadata}->'slack'->>'channel_id' = ${input.channel_id}`
          : undefined,
        input.since ? gte(runs.created_time, input.since) : undefined,
      ),
    )
    .orderBy(asc(run_messages.content_text), desc(runs.created_time), desc(runs.run_id))
    .limit(input.prompts.length) as Promise<SlackEvalRunCandidate[]>;
}
