import {
  describe_error_with_cause,
  find_database_error_details,
} from '@coworker/core/db/database_error';
import { describe, expect, it } from 'vitest';

// Shaped like what actually reaches a catch block: drizzle's wrapper carries only the SQL text,
// and the driver's error — the half worth storing — hangs off `cause`.
function drizzle_query_error() {
  const driver_error = Object.assign(
    new Error(
      'duplicate key value violates unique constraint "idx_run_events_run_sequence_unique"',
    ),
    {
      code: '23505',
      constraint_name: 'idx_run_events_run_sequence_unique',
      detail: 'Key (run_id, event_sequence)=(run_1, 15) already exists.',
    },
  );

  return new Error(
    'Failed query: WITH batch (run_event_id, position) AS (VALUES ($1, $2))\nparams: evt_1,1',
    {
      cause: driver_error,
    },
  );
}

describe('database error details', () => {
  it('reads the SQLSTATE, constraint, and detail off the cause', () => {
    expect(find_database_error_details(drizzle_query_error())).toEqual({
      code: '23505',
      constraint_name: 'idx_run_events_run_sequence_unique',
      detail: 'Key (run_id, event_sequence)=(run_1, 15) already exists.',
      message: expect.stringContaining('duplicate key value'),
    });
  });

  it('finds a driver error wrapped more than one layer deep', () => {
    const rewrapped = new Error('recording the run failed', { cause: drizzle_query_error() });

    expect(find_database_error_details(rewrapped)?.code).toBe('23505');
  });

  it('returns nothing for an error that never came from Postgres', () => {
    expect(find_database_error_details(new Error('the model timed out'))).toBeUndefined();
  });

  it('leads with the root cause so truncation keeps the diagnosis', () => {
    const described = describe_error_with_cause(drizzle_query_error());

    expect(described.startsWith('[23505]')).toBe(true);
    expect(described).toContain('constraint=idx_run_events_run_sequence_unique');
    expect(described).toContain('Key (run_id, event_sequence)=(run_1, 15) already exists.');
    expect(described).toContain('while running: Failed query');
  });

  it('passes a plain error through unchanged', () => {
    expect(describe_error_with_cause(new Error('the model timed out'))).toBe('the model timed out');
  });
});
