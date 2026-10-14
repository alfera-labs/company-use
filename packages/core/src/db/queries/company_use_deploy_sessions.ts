import type { DatabaseExecutor } from '@coworker/core/db/connection';
import { updated_by } from '@coworker/core/db/schema/common';
import {
  company_use_deploy_sessions,
  type DeployProgressLine,
} from '@coworker/core/db/schema/company_use_deploy';
import { and, eq, gt, inArray, lte, sql } from 'drizzle-orm';

const deploy_page_actor = 'system:company_use_deploy';

export type NewDeploySession = {
  install_id: string;
  report_token_hash: string;
  cloud: string;
  expires_time: Date;
};

export async function insert_deploy_session(
  db: DatabaseExecutor,
  input: NewDeploySession,
): Promise<{ report_token_hash: string } | null> {
  await db
    .insert(company_use_deploy_sessions)
    .values({ ...input, created_by: deploy_page_actor, last_updated_by: deploy_page_actor })
    .onConflictDoUpdate({
      target: company_use_deploy_sessions.install_id,
      set: {
        report_token_hash: input.report_token_hash,
        cloud: input.cloud,
        progress_lines: sql`'[]'::jsonb`,
        expires_time: input.expires_time,
        ...updated_by(deploy_page_actor),
      },
      setWhere: sql`${company_use_deploy_sessions.expires_time} <= now() OR (${company_use_deploy_sessions.report_token_hash} = ${input.report_token_hash} AND jsonb_array_length(${company_use_deploy_sessions.progress_lines}) = 0)`,
    });
  const [row] = await db
    .select({ report_token_hash: company_use_deploy_sessions.report_token_hash })
    .from(company_use_deploy_sessions)
    .where(eq(company_use_deploy_sessions.install_id, input.install_id));
  return row ?? null;
}

export async function count_live_deploy_sessions(db: DatabaseExecutor): Promise<number> {
  const [row] = await db
    .select({ live_count: sql<number>`count(*)::int` })
    .from(company_use_deploy_sessions)
    .where(gt(company_use_deploy_sessions.expires_time, sql`now()`));
  return row?.live_count ?? 0;
}

export async function find_live_deploy_session(db: DatabaseExecutor, install_id: string) {
  const [row] = await db
    .select({
      report_token_hash: company_use_deploy_sessions.report_token_hash,
      progress_lines: company_use_deploy_sessions.progress_lines,
    })
    .from(company_use_deploy_sessions)
    .where(
      and(
        eq(company_use_deploy_sessions.install_id, install_id),
        gt(company_use_deploy_sessions.expires_time, sql`now()`),
      ),
    );
  return row ?? null;
}

export async function append_deploy_progress_line(
  db: DatabaseExecutor,
  input: {
    install_id: string;
    line: DeployProgressLine;
    most_lines: number;
    expires_time_after_first_line: Date;
  },
): Promise<boolean> {
  const lines = company_use_deploy_sessions.progress_lines;
  const kept_lines = sql`CASE WHEN jsonb_array_length(${lines}) >= ${input.most_lines} THEN ${lines} - 0 ELSE ${lines} END`;
  const expires_time = sql`CASE WHEN jsonb_array_length(${lines}) = 0 THEN ${input.expires_time_after_first_line.toISOString()}::timestamptz ELSE ${company_use_deploy_sessions.expires_time} END`;
  const updated = await db
    .update(company_use_deploy_sessions)
    .set({
      progress_lines: sql`${kept_lines} || jsonb_build_array(${JSON.stringify(input.line)}::jsonb)`,
      expires_time,
      ...updated_by(deploy_page_actor),
    })
    .where(
      and(
        eq(company_use_deploy_sessions.install_id, input.install_id),
        gt(company_use_deploy_sessions.expires_time, sql`now()`),
      ),
    )
    .returning({ install_id: company_use_deploy_sessions.install_id });
  return updated.length > 0;
}

const sessions_deleted_per_batch = 1000;

async function delete_one_batch_of_expired_sessions(db: DatabaseExecutor) {
  const expired = db
    .select({ install_id: company_use_deploy_sessions.install_id })
    .from(company_use_deploy_sessions)
    .where(lte(company_use_deploy_sessions.expires_time, sql`now()`))
    .limit(sessions_deleted_per_batch);
  const deleted = await db
    .delete(company_use_deploy_sessions)
    .where(inArray(company_use_deploy_sessions.install_id, expired))
    .returning({ install_id: company_use_deploy_sessions.install_id });
  return deleted.length;
}

export async function delete_expired_deploy_sessions(
  db: DatabaseExecutor,
  batches_left = 20,
): Promise<number> {
  const deleted = await delete_one_batch_of_expired_sessions(db);
  if (deleted < sessions_deleted_per_batch || batches_left <= 1) return deleted;
  return deleted + (await delete_expired_deploy_sessions(db, batches_left - 1));
}
