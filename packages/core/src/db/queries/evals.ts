import type { Database } from '@coworker/core/db/connection';
import { require_inserted_row } from '@coworker/core/db/queries/require_inserted_row';
import { eval_reports } from '@coworker/core/db/schema';
import { merge_metadata } from '@coworker/core/db/schema/common';
import { create_id, id_prefixes } from '@coworker/shared';
import { and, desc, eq } from 'drizzle-orm';

export type CreateEvalReportInput = {
  suite_name: string;
  task_source: 'internal' | 'slack' | 'swe_bench' | 'terminal_bench';
  task_id: string;
  run_id: string;
  runtime_environment_id?: string | null;
  harness_name?: string;
  harness_version: string;
  runtime_version: string;
  model_id: string;
  status: 'pass' | 'fail' | 'error';
  failure_reason?: string | null;
  duration_ms: number;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cost_microcents?: number;
  tool_call_count?: number;
  trace_pointer: string;
  metadata?: Record<string, unknown>;
  actor_id: string;
};

export async function create_eval_report(db: Database, input: CreateEvalReportInput) {
  const [eval_report] = await db
    .insert(eval_reports)
    .values({
      eval_report_id: create_id(id_prefixes.eval_report),
      suite_name: input.suite_name,
      task_source: input.task_source,
      task_id: input.task_id,
      run_id: input.run_id,
      runtime_environment_id: input.runtime_environment_id ?? null,
      harness_name: input.harness_name ?? 'coworker',
      harness_version: input.harness_version,
      runtime_version: input.runtime_version,
      model_id: input.model_id,
      status: input.status,
      failure_reason: input.failure_reason ?? null,
      duration_ms: input.duration_ms,
      input_tokens: input.input_tokens ?? 0,
      output_tokens: input.output_tokens ?? 0,
      cache_read_tokens: input.cache_read_tokens ?? 0,
      cost_microcents: input.cost_microcents ?? 0,
      tool_call_count: input.tool_call_count ?? 0,
      trace_pointer: input.trace_pointer,
      metadata: input.metadata ?? {},
      created_by: input.actor_id,
      last_updated_by: input.actor_id,
    })
    .returning();

  return require_inserted_row(eval_report, 'Eval report');
}

export type UpdateEvalReportInput = Omit<
  CreateEvalReportInput,
  'suite_name' | 'task_source' | 'task_id' | 'run_id'
> & {
  eval_report_id: string;
};

export async function update_eval_report(db: Database, input: UpdateEvalReportInput) {
  const [eval_report] = await db
    .update(eval_reports)
    .set({
      runtime_environment_id: input.runtime_environment_id ?? null,
      harness_name: input.harness_name ?? 'coworker',
      harness_version: input.harness_version,
      runtime_version: input.runtime_version,
      model_id: input.model_id,
      status: input.status,
      failure_reason: input.failure_reason ?? null,
      duration_ms: input.duration_ms,
      input_tokens: input.input_tokens ?? 0,
      output_tokens: input.output_tokens ?? 0,
      cache_read_tokens: input.cache_read_tokens ?? 0,
      cost_microcents: input.cost_microcents ?? 0,
      tool_call_count: input.tool_call_count ?? 0,
      trace_pointer: input.trace_pointer,
      metadata: merge_metadata(eval_reports.metadata, input.metadata ?? {}),
      last_updated_time: new Date(),
      last_updated_by: input.actor_id,
    })
    .where(eq(eval_reports.eval_report_id, input.eval_report_id))
    .returning();

  return require_inserted_row(eval_report, 'Eval report');
}

export async function list_eval_reports(
  db: Database,
  input: { suite_name: string; runtime_version?: string },
) {
  return db.query.eval_reports.findMany({
    where:
      input.runtime_version === undefined
        ? eq(eval_reports.suite_name, input.suite_name)
        : and(
            eq(eval_reports.suite_name, input.suite_name),
            eq(eval_reports.runtime_version, input.runtime_version),
          ),
    orderBy: [desc(eval_reports.created_time)],
  });
}
