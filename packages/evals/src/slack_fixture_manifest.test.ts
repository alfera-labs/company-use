import {
  create_slack_fixture_manifest,
  parse_slack_fixture_manifest,
  ready_fixture_by_task,
} from '@coworker/evals/slack_fixture_manifest';
import { describe, expect, it } from 'vitest';

describe('Slack fixture manifest', () => {
  it('assigns stable Gmail aliases and workspace names by task order', () => {
    const manifest = create_slack_fixture_manifest(
      'slack_operator',
      ['connection_001', 'finance_001'],
      'fixtures@example.com',
    );

    expect(manifest.fixtures).toMatchObject([
      {
        task_id: 'connection_001',
        account_email: 'fixtures+1@example.com',
        slack_actor_email: 'fixtures@example.com',
        slack_workspace_name: 'Alfera Eval 001 connection_001',
      },
      {
        task_id: 'finance_001',
        account_email: 'fixtures+2@example.com',
        slack_actor_email: 'fixtures@example.com',
        slack_workspace_name: 'Alfera Eval 002 finance_001',
      },
    ]);
  });

  it('uses the base Gmail identity as the Slack actor for older manifests', () => {
    const manifest = create_slack_fixture_manifest('slack_operator', ['a'], 'u@example.com');
    const fixture = manifest.fixtures[0];
    if (!fixture) throw new Error('Expected a fixture');
    const { slack_actor_email: _slack_actor_email, ...older_fixture } = fixture;

    const parsed = parse_slack_fixture_manifest({ ...manifest, fixtures: [older_fixture] });

    expect(parsed.fixtures[0]?.slack_actor_email).toBe('u@example.com');
  });

  it('rejects duplicate Slack teams and incomplete ready fixtures', () => {
    const manifest = create_slack_fixture_manifest('slack_operator', ['a', 'b'], 'u@example.com');
    const first_fixture = manifest.fixtures[0];
    const second_fixture = manifest.fixtures[1];
    if (!first_fixture || !second_fixture) throw new Error('Expected two fixtures');
    manifest.fixtures[0] = {
      ...first_fixture,
      status: 'ready',
      product_user_id: 'user_a',
      product_workspace_id: 'ws_a',
      slack_team_id: 'T123',
      slack_channel_id: 'C123',
    };
    manifest.fixtures[1] = {
      ...second_fixture,
      status: 'ready',
      product_user_id: 'user_b',
      product_workspace_id: 'ws_b',
      slack_team_id: 'T123',
      slack_channel_id: 'C456',
    };

    expect(() => parse_slack_fixture_manifest(manifest)).toThrow(
      'slack_team_id values must be unique',
    );

    manifest.fixtures[1] = { ...second_fixture, slack_team_id: 'T456' };
    const parsed = parse_slack_fixture_manifest(manifest);
    delete parsed.fixtures[0]?.slack_channel_id;
    expect(() => ready_fixture_by_task(parsed)).toThrow('missing runtime identifiers');
  });
});
