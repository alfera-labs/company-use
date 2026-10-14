import type { ConnectorFanOutItemResult } from '@connectors/types';

type AttioValue = {
  attribute_type?: string | null;
  active_from?: string | null;
  active_until?: string | null;
  value?: string | number | boolean | null;
  full_name?: string | null;
  email_address?: string | null;
  domain?: string | null;
  phone_number?: string | null;
  target_record_id?: string | null;
  referenced_actor_id?: string | null;
  currency_value?: number | null;
  interacted_at?: string | null;
  locality?: string | null;
  status?: { title?: string | null } | null;
  option?: { title?: string | null } | null;
};

export type AttioRecord = {
  id: { workspace_id: string; object_id: string; record_id: string };
  created_at?: string | null;
  web_url?: string | null;
  values?: Record<string, AttioValue[]> | null;
};

export type AttioSingleRecordResponse = { data: AttioRecord };

export type AttioRecordPageResponse = { data: AttioRecord[] };

type AttioReadableValue = string | number | boolean | null;

export type AttioRecordOutput = {
  record_id: string;
  object_id: string;
  workspace_id: string;
  created_at: string | null;
  web_url: string | null;
  attributes: Record<string, AttioReadableValue[]>;
  values: Record<string, AttioValue[]>;
};

function readable_attio_value(value: AttioValue): AttioReadableValue {
  return (
    value.value ??
    value.full_name ??
    value.email_address ??
    value.domain ??
    value.phone_number ??
    value.target_record_id ??
    value.referenced_actor_id ??
    value.currency_value ??
    value.status?.title ??
    value.option?.title ??
    value.interacted_at ??
    value.locality ??
    null
  );
}

export function to_attio_record_output(record: AttioRecord): AttioRecordOutput {
  const values = record.values ?? {};
  return {
    record_id: record.id.record_id,
    object_id: record.id.object_id,
    workspace_id: record.id.workspace_id,
    created_at: record.created_at ?? null,
    web_url: record.web_url ?? null,
    attributes: Object.fromEntries(
      Object.entries(values).map(([slug, entries]) => [slug, entries.map(readable_attio_value)]),
    ),
    values,
  };
}

export type AttioWriteResult =
  | { ok: true; index: number; record: AttioRecordOutput }
  | { ok: false; index: number; error: { code: string; message: string; retryable: boolean } };

export function to_attio_write_result(
  outcome: ConnectorFanOutItemResult<AttioRecord>,
): AttioWriteResult {
  if (!outcome.ok) return { ok: false, index: outcome.index, error: outcome.error };
  return { ok: true, index: outcome.index, record: to_attio_record_output(outcome.data) };
}

export type AttioWriteValues = Record<string, unknown>;
