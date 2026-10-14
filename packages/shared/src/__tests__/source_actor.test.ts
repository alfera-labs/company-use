import { create_external_source_actor, merge_session_source_actor } from '@shared/source_actor';
import { describe, expect, it } from 'vitest';

describe('source actor metadata', () => {
  it('normalizes external actor ids and profile fields', () => {
    const actor = create_external_source_actor({
      provider_key: 'slack',
      external_account_id: 'T123',
      external_user_id: 'U123',
      external_username: 'oli',
      profile: {
        display_name: ' Oli ',
        email: 'FOUNDER@RUNTIME.LOCAL',
        email_is_verified: true,
        avatar_url: ' https://example.test/avatar.png ',
        profile_source: 'provider_profile',
      },
      policy_state: 'allowed_to_chat',
    });

    expect(actor).toEqual({
      source_actor_id: 'slack:T123:U123',
      actor_kind: 'external_user',
      external_ids: [
        {
          provider_key: 'slack',
          external_account_id: 'T123',
          external_user_id: 'U123',
          external_username: 'oli',
        },
      ],
      profile: {
        display_name: 'Oli',
        email: 'founder@runtime.local',
        email_is_verified: true,
        avatar_url: 'https://example.test/avatar.png',
        profile_source: 'provider_profile',
      },
      policy_state: 'allowed_to_chat',
    });
  });

  it('merges repeated actors into the session roster by source actor id', () => {
    const actor = create_external_source_actor({
      provider_key: 'slack',
      external_account_id: 'T123',
      external_user_id: 'U123',
      profile: { display_name: 'Oli' },
    });
    const first = merge_session_source_actor([], actor, new Date('2026-06-01T10:00:00.000Z'));
    const second = merge_session_source_actor(
      first,
      create_external_source_actor({
        provider_key: 'slack',
        external_account_id: 'T123',
        external_user_id: 'U123',
        profile: { display_name: 'Olivier' },
      }),
      new Date('2026-06-01T10:05:00.000Z'),
    );

    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({
      source_actor_id: 'slack:T123:U123',
      profile: { display_name: 'Olivier' },
      first_seen_time: '2026-06-01T10:00:00.000Z',
      last_seen_time: '2026-06-01T10:05:00.000Z',
      message_count: 2,
    });
  });
});
