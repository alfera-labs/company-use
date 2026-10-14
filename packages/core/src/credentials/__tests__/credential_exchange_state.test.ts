import {
  type CredentialExchangeState,
  decide_whether_to_attempt,
  generate_credential_exchange_state,
  read_credential_exchange_state,
  write_credential_exchange_state,
} from '@coworker/core/credentials/credential_exchange_state';
import { describe, expect, it } from 'vitest';

const now = new Date('2026-07-31T12:00:00.000Z');

function create_state(overrides: Partial<CredentialExchangeState> = {}): CredentialExchangeState {
  return {
    last_outcome: 'rejected',
    last_attempted_time: '2026-07-31T11:00:00.000Z',
    consecutive_failure_count: 1,
    ...overrides,
  };
}

describe('decide_whether_to_attempt', () => {
  it('refuses while the wait the vendor asked for is still running', () => {
    const decision = decide_whether_to_attempt({
      state: create_state({
        last_outcome: 'rate_limited',
        retry_allowed_after_time: '2026-07-31T12:30:00.000Z',
      }),
      now,
      stop_after_failures: 1,
    });

    expect(decision).toMatchObject({
      may_attempt: false,
      retry_allowed_after_time: '2026-07-31T12:30:00.000Z',
    });
  });

  it('allows another attempt once that wait has passed', () => {
    expect(
      decide_whether_to_attempt({
        state: create_state({
          last_outcome: 'rate_limited',
          retry_allowed_after_time: '2026-07-31T11:59:00.000Z',
          consecutive_failure_count: 3,
        }),
        now,
        stop_after_failures: 1,
      }),
    ).toEqual({ may_attempt: true });
  });

  it('stops guessing a password the vendor already rejected', () => {
    expect(
      decide_whether_to_attempt({ state: create_state(), now, stop_after_failures: 1 }),
    ).toMatchObject({ may_attempt: false });
  });

  it('still tries when the failure count is under the limit', () => {
    expect(
      decide_whether_to_attempt({
        state: create_state({ consecutive_failure_count: 1 }),
        now,
        stop_after_failures: 3,
      }),
    ).toEqual({ may_attempt: true });
  });

  it('does not treat an unreachable site as a rejection', () => {
    expect(
      decide_whether_to_attempt({
        state: create_state({ last_outcome: 'unreachable', consecutive_failure_count: 9 }),
        now,
        stop_after_failures: 1,
      }),
    ).toEqual({ may_attempt: true });
  });

  it('attempts freely when nothing has been tried yet', () => {
    expect(decide_whether_to_attempt({ state: null, now, stop_after_failures: 1 })).toEqual({
      may_attempt: true,
    });
  });
});

describe('generate_credential_exchange_state', () => {
  it("turns the vendor's wait into a time we can check later", () => {
    expect(
      generate_credential_exchange_state({
        previous: null,
        outcome: 'rate_limited',
        now,
        wait_minutes: 30,
      }),
    ).toMatchObject({
      last_outcome: 'rate_limited',
      retry_allowed_after_time: '2026-07-31T12:30:00.000Z',
      consecutive_failure_count: 1,
    });
  });

  it('counts consecutive failures so a second guess can be refused', () => {
    expect(
      generate_credential_exchange_state({
        previous: create_state({ consecutive_failure_count: 2 }),
        outcome: 'rejected',
        now,
      }).consecutive_failure_count,
    ).toBe(3);
  });

  it('clears the count and the wait once the exchange succeeds', () => {
    const state = generate_credential_exchange_state({
      previous: create_state({
        consecutive_failure_count: 5,
        retry_allowed_after_time: '2026-07-31T13:00:00.000Z',
      }),
      outcome: 'succeeded',
      now,
    });

    expect(state.consecutive_failure_count).toBe(0);
    expect(state.retry_allowed_after_time).toBeUndefined();
  });
});

describe('reading and writing connection_config', () => {
  it('leaves the access-control block that already lives there untouched', () => {
    const connection_config = {
      access_type: 'restricted',
      allowed_users: ['user_1'],
      credential_delivery_mode: 'attached_at_egress',
    };

    const written = write_credential_exchange_state(connection_config, create_state());

    expect(written).toMatchObject(connection_config);
    expect(read_credential_exchange_state(written)).toMatchObject({ last_outcome: 'rejected' });
  });

  it('reads nothing rather than guessing when the stored block is malformed', () => {
    expect(
      read_credential_exchange_state({ credential_exchange: { last_outcome: 'nonsense' } }),
    ).toBeNull();
    expect(read_credential_exchange_state({})).toBeNull();
    expect(read_credential_exchange_state(null)).toBeNull();
  });
});
