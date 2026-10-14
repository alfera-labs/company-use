import { build_participants } from '@coworker/core/access/build_participants';
import { may_use_resource } from '@coworker/core/access/may_use_resource';
import type { SessionMetadata } from '@coworker/core/db/schema/json_column_types';
import { describe, expect, it } from 'vitest';

function actor(input: { source_actor_id: string; actor_kind: string; platform_user_id?: string }) {
  return {
    source_actor_id: input.source_actor_id,
    actor_kind: input.actor_kind,
    platform_user_id: input.platform_user_id ?? null,
    external_ids: [],
    profile: {},
    first_seen_time: '2026-08-21T00:00:00Z',
    last_seen_time: '2026-08-21T00:00:00Z',
    message_count: 1,
  } as NonNullable<SessionMetadata['actors']>[number];
}

describe('build_participants', () => {
  it('uses the platform id when a speaker is linked, so one human is one participant', () => {
    const participants = build_participants({
      project_id: 'proj_support',
      session_metadata: {
        actors: [
          actor({
            source_actor_id: 'sactor_1',
            actor_kind: 'platform_user',
            platform_user_id: 'usr_alice',
          }),
        ],
      },
      session_source_metadata: null,
      agent_ids: ['agt_ext'],
    });
    expect(participants).toEqual({
      project: ['proj_support'],
      agent: ['agt_ext'],
      user: ['usr_alice'],
    });
  });

  it('leaves the project list empty when a conversation is in no project', () => {
    const participants = build_participants({
      project_id: null,
      session_metadata: { actors: [] },
      session_source_metadata: null,
      agent_ids: ['agt_ext'],
    });
    expect(participants.project).toEqual([]);
  });

  it('counts an external customer as a reader, because they see the output', () => {
    const participants = build_participants({
      project_id: 'proj_support',
      session_metadata: {
        actors: [
          actor({
            source_actor_id: 'sactor_1',
            actor_kind: 'platform_user',
            platform_user_id: 'usr_alice',
          }),
          actor({ source_actor_id: 'cust_9182', actor_kind: 'external_user' }),
        ],
      },
      session_source_metadata: null,
      agent_ids: ['agt_ext'],
    });
    expect(participants.user).toEqual(['usr_alice', 'cust_9182']);
  });

  it('excludes the agent and the platform itself from the reader list', () => {
    const participants = build_participants({
      project_id: null,
      session_metadata: {
        actors: [
          actor({ source_actor_id: 'agt_ext', actor_kind: 'agent' }),
          actor({ source_actor_id: 'sys_1', actor_kind: 'system' }),
          actor({
            source_actor_id: 'sactor_1',
            actor_kind: 'platform_user',
            platform_user_id: 'usr_alice',
          }),
        ],
      },
      session_source_metadata: null,
      agent_ids: ['agt_ext'],
    });
    expect(participants.user).toEqual(['usr_alice']);
  });

  it('counts a repeat speaker once', () => {
    const participants = build_participants({
      project_id: null,
      session_metadata: {
        actors: [
          actor({
            source_actor_id: 'sactor_1',
            actor_kind: 'platform_user',
            platform_user_id: 'usr_alice',
          }),
          actor({
            source_actor_id: 'sactor_2',
            actor_kind: 'platform_user',
            platform_user_id: 'usr_alice',
          }),
        ],
      },
      session_source_metadata: null,
      agent_ids: [],
    });
    expect(participants.user).toEqual(['usr_alice']);
  });
});

describe('the embed guarantee, end to end from a session', () => {
  const staff_only = [
    { grantee_type: 'user' as const, grantee_id: 'usr_alice', grant_level: 'use' as const },
  ];

  it('allows a staff-only resource while only staff are present', () => {
    const participants = build_participants({
      project_id: 'proj_support',
      session_metadata: {
        actors: [
          actor({
            source_actor_id: 's1',
            actor_kind: 'platform_user',
            platform_user_id: 'usr_alice',
          }),
        ],
      },
      session_source_metadata: null,
      agent_ids: ['agt_ext'],
    });
    expect(
      may_use_resource({
        default_access: 'everyone_in_the_workspace',
        grants: staff_only,
        participants,
      }),
    ).toEqual({ allowed: true, grant_level: 'use' });
  });

  it('denies it the moment an external customer is in the conversation', () => {
    const participants = build_participants({
      project_id: 'proj_support',
      session_metadata: {
        actors: [
          actor({
            source_actor_id: 's1',
            actor_kind: 'platform_user',
            platform_user_id: 'usr_alice',
          }),
          actor({ source_actor_id: 'cust_9182', actor_kind: 'external_user' }),
        ],
      },
      session_source_metadata: null,
      agent_ids: ['agt_ext'],
    });
    expect(
      may_use_resource({
        default_access: 'everyone_in_the_workspace',
        grants: staff_only,
        participants,
      }),
    ).toMatchObject({ allowed: false, blocked_grantee_ids: ['cust_9182'] });
  });
});

// A Slack channel is read by people who never type. Its audience is one more reader who holds no
// personal grant, so a connection shared with "Only Rob" stays out of the channel even when Rob is
// the only speaker; the channel's project still gets what the project was given.
describe('a shared Slack channel', () => {
  const rob_alone = {
    actors: [
      actor({
        source_actor_id: 'sactor_rob',
        actor_kind: 'platform_user',
        platform_user_id: 'usr_rob',
      }),
    ],
  };
  const slack = (channel_type: string) => ({
    slack: { team_id: 'T1', channel_id: channel_type === 'im' ? 'D1' : 'C1', channel_type },
  });
  const only_rob = [
    { grantee_type: 'user' as const, grantee_id: 'usr_rob', grant_level: 'use' as const },
  ];
  const sales_only = [
    { grantee_type: 'project' as const, grantee_id: 'proj_sales', grant_level: 'use' as const },
  ];
  const verdict = (grants: typeof only_rob | typeof sales_only, channel_type: string) =>
    may_use_resource({
      default_access: 'everyone_in_the_workspace',
      grants,
      participants: build_participants({
        project_id: channel_type === 'im' ? 'proj_rob_private' : 'proj_sales',
        session_metadata: rob_alone,
        session_source_metadata: slack(channel_type),
        agent_ids: ['agt_main'],
      }),
    }).allowed;

  it('adds the channel audience as a reader in channels and group DMs, never in a DM', () => {
    const readers = (channel_type: string) =>
      build_participants({
        project_id: null,
        session_metadata: rob_alone,
        session_source_metadata: slack(channel_type),
        agent_ids: ['agt_main'],
      }).user;
    expect(readers('channel')).toEqual(['usr_rob', 'slack_channel_audience:T1:C1']);
    expect(readers('group')).toEqual(['usr_rob', 'slack_channel_audience:T1:C1']);
    expect(readers('mpim')).toEqual(['usr_rob', 'slack_channel_audience:T1:C1']);
    expect(readers('im')).toEqual(['usr_rob']);
  });

  it("keeps Rob's own connection out of #sales even when he is the only one typing", () => {
    expect(verdict(only_rob, 'channel')).toBe(false);
  });

  it('lets #sales use what the Sales project was given', () => {
    expect(verdict(sales_only, 'channel')).toBe(true);
  });

  it('lets Rob use his own connection in his DM', () => {
    expect(verdict(only_rob, 'im')).toBe(true);
  });
});
