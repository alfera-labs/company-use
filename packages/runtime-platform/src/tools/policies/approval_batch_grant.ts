import { read_template_sha256 } from '@coworker/core/access/policy_grants';
import type { ToolApprovalView } from '@runtime-platform/tools/policies/approval_reader_service';
import { z } from 'zod';

export const min_batch_calls = 5;

export const max_named_recipients = 5;

const call_input_schema = z.record(z.string(), z.unknown());

export type ApprovalBatch = {
  node_key: string;
  template_fields: string[];
  template_sha256: string;
  varying_fields: string[];
  recipients: string[];
  call_count: number;
  max_per_day: number;
};

export function read_approval_batch(view: ToolApprovalView): ApprovalBatch | null {
  const calls = view.calls;
  if (calls.length < min_batch_calls) return null;

  const node_key = calls[0]?.node_key;
  if (!node_key || calls.some((call) => call.node_key !== node_key)) return null;

  const records = calls.flatMap((call) => {
    const parsed = call_input_schema.safeParse(call.input);
    return parsed.success ? [parsed.data] : [];
  });
  if (records.length !== calls.length) return null;

  const fields = shared_field_names(records);
  if (!fields) return null;
  const template_fields = fields.filter((field) => is_same_everywhere(records, field));
  const varying_fields = fields.filter((field) => !is_same_everywhere(records, field));
  if (template_fields.length === 0 || varying_fields.length === 0) return null;

  const template_sha256 = read_template_sha256(records[0], template_fields);
  if (!template_sha256) return null;

  return {
    node_key,
    template_fields,
    template_sha256,
    varying_fields,
    recipients: records.map((record) => describe_varying_values(record, varying_fields)),
    call_count: records.length,
    max_per_day: records.length,
  };
}

function shared_field_names(records: readonly Record<string, unknown>[]) {
  const [first, ...rest] = records;
  if (!first) return null;
  const names = Object.keys(first).sort();
  const key = names.join(',');
  return rest.every((record) => Object.keys(record).sort().join(',') === key) ? names : null;
}

function is_same_everywhere(records: readonly Record<string, unknown>[], field: string) {
  const first = JSON.stringify(records[0]?.[field] ?? null);
  return records.every((record) => JSON.stringify(record[field] ?? null) === first);
}

function describe_varying_values(record: Record<string, unknown>, fields: readonly string[]) {
  return fields
    .map((field) =>
      typeof record[field] === 'string' ? record[field] : JSON.stringify(record[field]),
    )
    .join(', ');
}
