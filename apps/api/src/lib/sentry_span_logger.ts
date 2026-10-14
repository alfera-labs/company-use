import { create_logger } from '@coworker/shared';

const database_log = create_logger('database');

type SentrySpan = {
  data: Record<string, unknown> & {
    'db.operation.name'?: string;
    'db.system.name'?: string;
    'sentry.origin'?: string;
  };
  description?: string;
  op?: string;
  origin?: string;
  span_id: string;
  start_timestamp: number;
  status?: string;
  timestamp?: number;
  trace_id: string;
};

export function log_sentry_database_span<TSpan extends SentrySpan>(span: TSpan): TSpan {
  if (!is_postgres_query_span(span) || span.timestamp === undefined) return span;

  const context = {
    trace_id: span.trace_id,
    span_id: span.span_id,
    operation: span.data['db.operation.name'],
    query: span.description,
    status: span.status ?? 'ok',
    duration_ms: Math.max(0, Math.round((span.timestamp - span.start_timestamp) * 1_000)),
  };

  if (is_failed_span(span.status)) database_log.error('query failed', context);
  else database_log.info('query completed', context);

  return span;
}

const postgres_span_origins = new Set(['auto.db.postgresjs', 'auto.db.otel.postgres']);

function is_postgres_query_span(span: SentrySpan) {
  const origin = span.origin ?? span.data['sentry.origin'];
  const database_system = span.data['db.system.name'];
  return (
    span.op === 'db' &&
    ((origin !== undefined && postgres_span_origins.has(origin)) || database_system === 'postgres')
  );
}

function is_failed_span(status: string | undefined) {
  return status !== undefined && status !== 'ok';
}
